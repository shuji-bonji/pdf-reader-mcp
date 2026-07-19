/**
 * Tests for pdfjs-service.ts
 */

import { resolve } from 'node:path';
import { ImageKind } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  buildIdToTextMap,
  countImages,
  describeImageKind,
  extractText,
  getMetadata,
  isMarkupAnnotation,
  loadDocument,
  resolveLineBreaks,
  searchText,
  type TextContentItemLike,
} from '../../src/services/pdfjs-service.js';

const SIMPLE_PDF = resolve(import.meta.dirname, '../fixtures/simple.pdf');
const EMPTY_PDF = resolve(import.meta.dirname, '../fixtures/empty.pdf');

// High-2 regression: read_images mapped pdfjs's ImageKind as
// `1 = RGB / 2 = RGBA / else Grayscale`. The real values are
// `GRAYSCALE_1BPP = 1 / RGB_24BPP = 2 / RGBA_32BPP = 3` — all three were wrong,
// and `bitsPerComponent` was hardcoded to 8, contradicting 1bpp grayscale.
describe('describeImageKind', () => {
  // Asserted against the literal numbers on purpose: importing ImageKind on both
  // sides would make the test tautological and let a renumbering slip through.
  it('maps GRAYSCALE_1BPP (kind=1) to Grayscale at 1 bit per component', () => {
    expect(describeImageKind(1)).toEqual({ colorSpace: 'Grayscale', bitsPerComponent: 1 });
  });

  it('maps RGB_24BPP (kind=2) to RGB at 8 bits per component', () => {
    expect(describeImageKind(2)).toEqual({ colorSpace: 'RGB', bitsPerComponent: 8 });
  });

  it('maps RGBA_32BPP (kind=3) to RGBA at 8 bits per component', () => {
    expect(describeImageKind(3)).toEqual({ colorSpace: 'RGBA', bitsPerComponent: 8 });
  });

  it('reports Unknown for an unrecognised or missing kind', () => {
    expect(describeImageKind(99).colorSpace).toBe('Unknown');
    expect(describeImageKind(undefined).colorSpace).toBe('Unknown');
  });

  // Guard against the numbering drifting in a future pdfjs-dist upgrade: if this
  // fails, the constants moved and the expectations above must be revisited.
  it("pdfjs ImageKind constants still match this module's assumptions", () => {
    expect(ImageKind.GRAYSCALE_1BPP).toBe(1);
    expect(ImageKind.RGB_24BPP).toBe(2);
    expect(ImageKind.RGBA_32BPP).toBe(3);
  });
});

// D-4 regression: the markup set was assembled by hand and got three things
// wrong — Popup was counted as markup, and FileAttachment / Sound / Projection
// were missing.
//
// The table below is the "Markup" column of ISO 32000-2 Table 171 — Annotation
// types, transcribed in full. The column is normative and covers every subtype,
// so this is a transcription check, not an interpretation.
describe('isMarkupAnnotation', () => {
  const TABLE_171: [string, boolean][] = [
    ['Text', true],
    ['Link', false],
    ['FreeText', true],
    ['Line', true],
    ['Square', true],
    ['Circle', true],
    ['Polygon', true],
    ['PolyLine', true],
    ['Highlight', true],
    ['Underline', true],
    ['Squiggly', true],
    ['StrikeOut', true],
    ['Caret', true],
    ['Stamp', true],
    ['Ink', true],
    ['Popup', false],
    ['FileAttachment', true],
    ['Sound', true],
    ['Movie', false],
    ['Screen', false],
    ['Widget', false],
    ['PrinterMark', false],
    ['TrapNet', false],
    ['Watermark', false],
    ['3D', false],
    ['Redact', true],
    ['Projection', true],
    ['RichMedia', false],
  ];

  for (const [subtype, expected] of TABLE_171) {
    it(`${subtype} → ${expected ? 'markup' : 'not markup'}`, () => {
      expect(isMarkupAnnotation(subtype)).toBe(expected);
    });
  }

  // 旧実装が間違えていた 4 件を明示的に固定する
  it('Popup is NOT markup (§12.5.6.2 が明示的に除外している)', () => {
    // "The remaining annotation types are not considered markup annotations:
    //  • The popup annotation type shall not appear by itself; it shall be
    //    associated with a markup annotation that uses it to display text."
    expect(isMarkupAnnotation('Popup')).toBe(false);
  });

  it('FileAttachment / Sound / Projection are markup (旧実装で漏れていた)', () => {
    expect(isMarkupAnnotation('FileAttachment')).toBe(true);
    expect(isMarkupAnnotation('Sound')).toBe(true); // PDF 2.0 で deprecated だが markup
    expect(isMarkupAnnotation('Projection')).toBe(true); // PDF 2.0 で追加
  });

  it('未知の subtype は markup 扱いしない', () => {
    expect(isMarkupAnnotation('Unknown')).toBe(false);
    expect(isMarkupAnnotation('')).toBe(false);
  });

  it('Table 171 の全 28 型を網羅している', () => {
    // 型が増えたらこのテストごと見直す、という宣言
    expect(TABLE_171).toHaveLength(28);
    expect(TABLE_171.filter(([, m]) => m)).toHaveLength(18);
  });
});

// M-8 / specs/08 §3.4: pdfjs marks line breaks of the ORIGINAL layout, and those
// are not content. A line break between words is a word break (a space); between
// two CJK characters it is nothing, because Japanese does not separate words with
// spaces — ISO 32000-2 §14.8.2.6.2 guarantees whitespace only where it "would be
// present to separate words in a pure text representation", and notes that "a word
// is defined by script and context".
//
// Without this, a Japanese paragraph that wrapped mid-sentence extracted as
// 「埋め草を大量 に含みます」 — the original wrap point welded into the content,
// which contradicts the whole point of reflow (the new layout re-wraps).
describe('resolveLineBreaks', () => {
  it('turns a line break between words into a space', () => {
    expect(resolveLineBreaks('This paragraph\nbegins here')).toBe('This paragraph begins here');
  });

  it('drops a line break between two CJK characters', () => {
    expect(resolveLineBreaks('埋め草を大量\nに含みます')).toBe('埋め草を大量に含みます');
    expect(resolveLineBreaks('段落を重ねて改ページを起\nこします')).toBe(
      '段落を重ねて改ページを起こします',
    );
  });

  it('keeps a space when only one side is CJK', () => {
    // 和欧混植の境界は語区切りとして扱う
    expect(resolveLineBreaks('日本語\nEnglish')).toBe('日本語 English');
    expect(resolveLineBreaks('English\n日本語')).toBe('English 日本語');
  });

  it('handles hiragana, katakana, kanji and fullwidth forms', () => {
    expect(resolveLineBreaks('ひらがな\nです')).toBe('ひらがなです');
    expect(resolveLineBreaks('カタカナ\nテスト')).toBe('カタカナテスト');
    expect(resolveLineBreaks('漢字\n試験')).toBe('漢字試験');
    expect(resolveLineBreaks('数値\n１２３')).toBe('数値１２３');
  });

  // CJK Symbols and Punctuation は U+3000 から始まる。ひらがな (U+3040) を
  // 起点にすると 。や 「 が漏れ、行頭に来うる 「 の直前に空白が入ってしまう。
  it('covers CJK punctuation, which starts below the kana block', () => {
    expect(resolveLineBreaks('です\n。')).toBe('です。');
    expect(resolveLineBreaks('彼は\n「こんにちは」')).toBe('彼は「こんにちは」');
  });

  it('leaves text without line breaks alone', () => {
    expect(resolveLineBreaks('no breaks here')).toBe('no breaks here');
    expect(resolveLineBreaks('')).toBe('');
  });
});

// M-8 regression: a line break can fall BETWEEN two marked-content sequences,
// not inside one. A writer lays out a wrapping paragraph as one MCID per line,
// and pdfjs emits each line as `beginMarkedContentProps(id)` → an empty item with
// `hasEOL: true` → the line's text → `endMarkedContent`. So a paragraph's line
// break is the boundary between id_n and id_{n+1}, with the break marker landing
// at the START of id_{n+1}.
//
// buildIdToTextMap therefore must keep the `\n` markers RAW and leave resolution
// to the caller, who joins the ids. Resolving per id turned the leading `\n` into
// a space (nothing precedes it within that id), which then welded into the join:
// 「…大 量に…」. The unit tests for resolveLineBreaks passed with literal `\n`
// input and never caught this, because they didn't exercise the join.
describe('buildIdToTextMap (marked-content boundaries)', () => {
  /** Mimic pdfjs: a marked-content sequence for one wrapped line. */
  const line = (id: string, text: string, leadingBreak: boolean): TextContentItemLike[] => [
    { type: 'beginMarkedContentProps', id },
    ...(leadingBreak ? [{ str: '', hasEOL: true } as TextContentItemLike] : []),
    { str: text, hasEOL: false },
    { type: 'endMarkedContent' },
  ];

  it('keeps line breaks raw so the caller can resolve them across ids', () => {
    // Two lines of one paragraph, each its own MCID; the 2nd starts with hasEOL.
    const items = [...line('mc0', '埋め草を大', false), ...line('mc1', '量に含みます', true)];
    const map = buildIdToTextMap(items);

    // Raw: the break marker is preserved at the start of the 2nd id.
    expect(map.get('mc0')).toBe('埋め草を大');
    expect(map.get('mc1')).toBe('\n量に含みます');
  });

  it('joining the ids and resolving yields no CJK gap (the real bug)', () => {
    const items = [...line('mc0', '埋め草を大', false), ...line('mc1', '量に含みます', true)];
    const map = buildIdToTextMap(items);

    // What the caller (textOf / compactCellText) does: join then resolve.
    const joined = (map.get('mc0') ?? '') + (map.get('mc1') ?? '');
    expect(resolveLineBreaks(joined).trim()).toBe('埋め草を大量に含みます');
  });

  it('an English wrap keeps the word break as a space', () => {
    const items = [...line('mc0', 'page one', false), ...line('mc1', 'and continues', true)];
    const map = buildIdToTextMap(items);

    const joined = (map.get('mc0') ?? '') + (map.get('mc1') ?? '');
    expect(resolveLineBreaks(joined).trim()).toBe('page one and continues');
  });

  it('excludes Artifact marked content (page numbers, running heads)', () => {
    const items: TextContentItemLike[] = [
      { type: 'beginMarkedContentProps', id: 'mc0' },
      { str: 'real content', hasEOL: false },
      { type: 'endMarkedContent' },
      { type: 'beginMarkedContent', tag: 'Artifact' },
      { str: 'page 1', hasEOL: false },
      { type: 'endMarkedContent' },
    ];
    const map = buildIdToTextMap(items);
    expect(map.get('mc0')).toBe('real content');
    // The artifact had no id and contributes to nothing.
    expect([...map.values()].some((v) => v.includes('page 1'))).toBe(false);
  });
});

describe('loadDocument', () => {
  it('should load a valid PDF', async () => {
    const doc = await loadDocument(SIMPLE_PDF);
    expect(doc.numPages).toBe(3);
    await doc.destroy();
  });
});

describe('getMetadata', () => {
  it('should return metadata with correct fields', async () => {
    const meta = await getMetadata(SIMPLE_PDF);
    expect(meta.pageCount).toBe(3);
    expect(meta.title).toBe('Test PDF Document');
    expect(meta.author).toBe('pdf-reader-mcp');
    expect(meta.subject).toBe('Test fixture');
    expect(meta.creator).toBe('pdf-lib');
    expect(meta.producer).toBe('pdf-reader-mcp test suite');
    expect(meta.fileSize).toBeGreaterThan(0);
  });

  it('should report empty PDF metadata', async () => {
    const meta = await getMetadata(EMPTY_PDF);
    expect(meta.pageCount).toBe(1);
    expect(meta.title).toBeNull();
    expect(meta.author).toBeNull();
  });
});

describe('extractText', () => {
  it('should extract text from all pages', async () => {
    const pages = await extractText(SIMPLE_PDF);
    expect(pages).toHaveLength(3);
    expect(pages[0].page).toBe(1);
    expect(pages[0].text).toContain('Hello PDF World');
  });

  it('should extract text from specific pages', async () => {
    const pages = await extractText(SIMPLE_PDF, '2');
    expect(pages).toHaveLength(1);
    expect(pages[0].page).toBe(2);
    expect(pages[0].text).toContain('Page Two');
  });

  it('should extract text from a page range', async () => {
    const pages = await extractText(SIMPLE_PDF, '1-2');
    expect(pages).toHaveLength(2);
    expect(pages[0].text).toContain('Hello PDF World');
    expect(pages[1].text).toContain('Page Two');
  });

  it('should return empty text for blank pages', async () => {
    const pages = await extractText(EMPTY_PDF);
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toBe('');
  });
});

describe('searchText', () => {
  it('should find case-insensitive matches', async () => {
    const { matches } = await searchText(SIMPLE_PDF, 'pdf');
    expect(matches.length).toBeGreaterThan(0);
    // "PDF" appears in "Hello PDF World" and other places
    const page1Matches = matches.filter((m) => m.page === 1);
    expect(page1Matches.length).toBeGreaterThan(0);
  });

  it('should return no matches for non-existent text', async () => {
    const { matches } = await searchText(SIMPLE_PDF, 'xyznonexistent');
    expect(matches).toHaveLength(0);
  });

  it('should search within specific pages', async () => {
    const { matches } = await searchText(SIMPLE_PDF, 'Page Two', 80, '2');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.page === 2)).toBe(true);
  });

  it('should include context around matches', async () => {
    const { matches } = await searchText(SIMPLE_PDF, 'digital signatures', 40);
    expect(matches.length).toBeGreaterThan(0);
    // Context should be present (non-empty around the match)
    const match = matches[0];
    expect(match.text.toLowerCase()).toContain('digital signatures');
  });
});

describe('countImages', () => {
  it('should count zero images in text-only PDF', async () => {
    const count = await countImages(SIMPLE_PDF);
    expect(count).toBe(0);
  });
});
