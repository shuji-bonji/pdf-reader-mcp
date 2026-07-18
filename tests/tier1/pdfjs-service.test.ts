/**
 * Tests for pdfjs-service.ts
 */

import { resolve } from 'node:path';
import { ImageKind } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  countImages,
  describeImageKind,
  extractText,
  getMetadata,
  isMarkupAnnotation,
  loadDocument,
  searchText,
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
    const matches = await searchText(SIMPLE_PDF, 'pdf');
    expect(matches.length).toBeGreaterThan(0);
    // "PDF" appears in "Hello PDF World" and other places
    const page1Matches = matches.filter((m) => m.page === 1);
    expect(page1Matches.length).toBeGreaterThan(0);
  });

  it('should return no matches for non-existent text', async () => {
    const matches = await searchText(SIMPLE_PDF, 'xyznonexistent');
    expect(matches).toHaveLength(0);
  });

  it('should search within specific pages', async () => {
    const matches = await searchText(SIMPLE_PDF, 'Page Two', 80, '2');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.page === 2)).toBe(true);
  });

  it('should include context around matches', async () => {
    const matches = await searchText(SIMPLE_PDF, 'digital signatures', 40);
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
