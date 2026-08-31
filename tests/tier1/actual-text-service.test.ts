/**
 * Unit tests for `/ActualText` resolution (#18).
 *
 * Two things are worth testing here without a PDF in the way:
 *
 *  - the **fold**, which decides what replaces what and which boundaries
 *    §14.9.4 says carry no word break. Feeding it synthetic pdfjs items keeps
 *    the cases (nesting, empty regions, non-consecutive pairs) explicit instead
 *    of hostage to a fixture that happens to contain them.
 *  - the **alignment guard**, which is the whole safety argument for reading
 *    property lists out of the content stream: a count that disagrees with
 *    pdfjs must abandon the replacement rather than apply it to the wrong glyphs.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openDocument } from '@normativepdf/recover';
import type { PdfDocument } from 'normativepdf';
import { describe, expect, it } from 'vitest';
import {
  buildSpanActualTextMap,
  buildStructActualTextMap,
  foldActualText,
} from '../../src/services/actual-text-service.js';
import { decodeTextString } from '../../src/services/content-stream-service.js';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');

/** A text item at `(x, y)`, `width` wide. */
function text(str: string, x: number, y: number, width = str.length * 6) {
  return { str, transform: [12, 0, 0, 12, x, y], width, height: 12 };
}

const begin = (id: string | null = null) => ({
  type: 'beginMarkedContentProps',
  tag: 'Span',
  id,
});
const end = { type: 'endMarkedContent' };

describe('foldActualText', () => {
  it('replaces the glyphs of a marked-content sequence with its ActualText', () => {
    const items = foldActualText(
      [text('Dru', 20, 150), begin(), text('k-', 38, 150), end, text('ker', 48, 150)],
      new Map(),
      new Map([[0, 'c']]),
    );
    expect(items.map((i) => i.str)).toEqual(['Dru', 'c', 'ker']);
    expect(items[1].replacement).toBeDefined();
    expect(items[0].replacement).toBeUndefined();
  });

  it('positions the replacement where the glyphs it replaced were', () => {
    const items = foldActualText(
      [begin(), text('k-', 38, 150, 10), end],
      new Map(),
      new Map([[0, 'c']]),
    );
    expect(items[0].transform[4]).toBe(38);
    expect(items[0].width).toBe(10);
  });

  it('resolves a structure element ActualText by marked-content id', () => {
    const items = foldActualText(
      [begin('p3R_mc8'), text('Dif`cult', 50, 600), end],
      new Map([['p3R_mc8', 'Difficult']]),
      new Map(),
    );
    expect(items.map((i) => i.str)).toEqual(['Difficult']);
  });

  // §14.9.4: the value is "a character substitution for the content enclosed by
  // the structure element or marked-content sequence" — enclosed, so a nested
  // sequence is part of what the outer one replaces, not a second replacement.
  it('lets the outermost ActualText swallow a nested one', () => {
    const items = foldActualText(
      [begin(), text('a', 10, 100), begin(), text('b', 20, 100), end, end],
      new Map(),
      new Map([
        [0, 'OUTER'],
        [1, 'INNER'],
      ]),
    );
    expect(items.map((i) => i.str)).toEqual(['OUTER']);
  });

  // R-14.9.4-3: "If each of two (or more) consecutive structure or
  // marked-content sequences has an ActualText entry, they shall be treated as
  // if no word break is present between them."
  it('marks consecutive replacements as adjacent', () => {
    const items = foldActualText(
      [begin(), text('Bäcke-', 20, 150), end, begin(), text('rei', 20, 130), end],
      new Map(),
      new Map([
        [0, 'Bäcke'],
        [1, 'rei'],
      ]),
    );
    expect(items[0].replacement?.adjacentToPrevious).toBe(false);
    expect(items[1].replacement?.adjacentToPrevious).toBe(true);
  });

  it('does not mark them adjacent when glyphs come between', () => {
    const items = foldActualText(
      [begin(), text('x', 20, 150), end, text('and', 30, 150), begin(), text('y', 60, 150), end],
      new Map(),
      // Keyed by begin-marker index, not item index: the page has two.
      new Map([
        [0, 'A'],
        [1, 'B'],
      ]),
    );
    expect(items.map((i) => i.str)).toEqual(['A', 'and', 'B']);
    expect(items[2].replacement?.adjacentToPrevious).toBe(false);
  });

  // Replacement text over a Figure has no glyphs to take a position from; it
  // still has to appear, at the last position known.
  it('emits a replacement for a sequence containing no text', () => {
    const items = foldActualText(
      [text('before', 10, 100), begin(), end],
      new Map(),
      new Map([[0, 'IMAGE']]),
    );
    expect(items.map((i) => i.str)).toEqual(['before', 'IMAGE']);
    expect(items[1].transform[4]).toBe(10);
  });

  it('leaves everything alone when there is nothing to replace', () => {
    const items = foldActualText(
      [text('plain', 10, 100), begin(), text('marked', 40, 100), end],
      new Map(),
      new Map(),
    );
    expect(items.map((i) => i.str)).toEqual(['plain', 'marked']);
    expect(items.every((i) => i.replacement === undefined)).toBe(true);
  });
});

describe('buildSpanActualTextMap', () => {
  // S3 以降、Span 側の内容ストリームも @normativepdf/recover が読む。
  async function load(name: string): Promise<PdfDocument> {
    const data = await readFile(resolve(FIXTURES, name));
    const { doc } = await openDocument(new Uint8Array(data));
    return doc;
  }

  it('reads the Span property lists the content stream carries', async () => {
    const doc = await load('actual-text-span.pdf');
    expect(await buildSpanActualTextMap(doc, 0, 1, false)).toEqual(new Map([[0, 'c']]));
    expect(await buildSpanActualTextMap(doc, 1, 2, false)).toEqual(
      new Map([
        [0, 'Bäcke'],
        [1, 'rei'],
      ]),
    );
  });

  // The alignment is by index, so a disagreement about how many sequences the
  // page has means every index after the first divergence is wrong. Refusing to
  // guess is the point: raw glyphs are the documented old behaviour, replacement
  // text on the wrong glyphs would be a new kind of wrong.
  it('returns undefined when the marker count disagrees with pdfjs', async () => {
    const doc = await load('actual-text-span.pdf');
    expect(await buildSpanActualTextMap(doc, 0, 2, false)).toBeUndefined();
    expect(await buildSpanActualTextMap(doc, 0, 0, false)).toBeUndefined();
  });

  it('is empty, not undefined, for a page with no marked content', async () => {
    const doc = await load('simple.pdf');
    expect((await buildSpanActualTextMap(doc, 0, 0, false))?.size).toBe(0);
  });

  // 鍵が導けない文書では内容ストリームを 1 バイトも読めない。0 件の地図を
  // 返すと「置き換えるものは無かった」と言ったことになるので、undefined を返す。
  it('is undefined when the key could not be derived', async () => {
    const doc = await load('actual-text-span.pdf');
    expect(await buildSpanActualTextMap(doc, 0, 1, true)).toBeUndefined();
  });
});

describe('buildStructActualTextMap', () => {
  it('maps every MCID an ActualText element owns', async () => {
    // S2 以降、構造木は @normativepdf/recover が読む（Span 側はまだ pdf-lib）。
    const { doc, scope } = await openDocument(
      new Uint8Array(await readFile(resolve(FIXTURES, 'structured.pdf'))),
    );
    const map = await buildStructActualTextMap(doc, scope.encrypted);
    expect([...map.values()]).toEqual(['Difficult']);
  });
});

describe('decodeTextString', () => {
  it('decodes PDFDocEncoding', () => {
    expect(decodeTextString(new Uint8Array([0x63]))).toBe('c');
  });

  it('decodes UTF-16BE when the BOM says so (§7.9.2.2)', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x42, 0x00, 0xe4]);
    expect(decodeTextString(bytes)).toBe('Bä');
  });

  it('decodes UTF-8 with the PDF 2.0 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Bä')]);
    expect(decodeTextString(bytes)).toBe('Bä');
  });

  // §14.9.4 defers to §7.9.2.2: an escape sequence "shall override the
  // prevailing Lang entry", so it is metadata about the string, not content.
  it('strips the language escape sequence from a UTF-16BE string', () => {
    // ESC d e ESC D r u c k e r
    const units = [0x1b, 0x64, 0x65, 0x1b, ...[...'Drucker'].map((c) => c.charCodeAt(0))];
    const bytes = new Uint8Array([0xfe, 0xff, ...units.flatMap((u) => [u >> 8, u & 0xff])]);
    expect(decodeTextString(bytes)).toBe('Drucker');
  });

  // §7.9.2.2.2 は「Escape sequences may appear anywhere in a **Unicode** text
  // string」と書き、要素 a) で UTF-16BE と UTF-8 だけを名指ししている。
  // PDFDocEncoding にエスケープは無く、Table D.3 でバイト 0x1B は U+02D9 である
  // —— そこを落とすのは本文の文字を消すことになる。
  it('keeps byte 0x1B in a PDFDocEncoded string (Table D.3: U+02D9)', () => {
    const escaped = `\u001bde\u001bDrucker`;
    const bytes = new Uint8Array([...escaped].map((c) => c.charCodeAt(0)));
    expect(decodeTextString(bytes)).toBe('\u02d9de\u02d9Drucker');
  });
});
