/**
 * Tests for utility modules.
 */

import { describe, expect, it } from 'vitest';
import { handleError, PdfReaderError, validatePdfPath } from '../../src/utils/error-handler.js';
import {
  formatPageList,
  formatStructuredTextMarkdown,
  truncateIfNeeded,
} from '../../src/utils/formatter.js';
import { parsePageRange } from '../../src/utils/pdf-helpers.js';

describe('parsePageRange', () => {
  it('should return null for undefined input', () => {
    expect(parsePageRange(undefined, 10)).toBeNull();
  });

  it('should parse a single page', () => {
    expect(parsePageRange('3', 10)).toEqual([3]);
  });

  it('should parse a page range', () => {
    expect(parsePageRange('2-5', 10)).toEqual([2, 3, 4, 5]);
  });

  it('should parse comma-separated pages', () => {
    expect(parsePageRange('1,3,5', 10)).toEqual([1, 3, 5]);
  });

  it('should parse mixed format', () => {
    expect(parsePageRange('1,3-5,8', 10)).toEqual([1, 3, 4, 5, 8]);
  });

  it('should deduplicate and sort', () => {
    expect(parsePageRange('5,3,5,1', 10)).toEqual([1, 3, 5]);
  });

  it('should throw for out-of-bounds range', () => {
    expect(() => parsePageRange('1-100', 5)).toThrow(PdfReaderError);
    expect(() => parsePageRange('0-3', 5)).toThrow(PdfReaderError);
  });

  it('should throw for invalid page number', () => {
    expect(() => parsePageRange('0', 10)).toThrow(PdfReaderError);
    expect(() => parsePageRange('11', 10)).toThrow(PdfReaderError);
  });

  it('should throw for invalid format', () => {
    expect(() => parsePageRange('abc', 10)).toThrow(PdfReaderError);
  });
});

describe('validatePdfPath', () => {
  it('should accept .pdf paths', () => {
    expect(() => validatePdfPath('/path/to/file.pdf')).not.toThrow();
    expect(() => validatePdfPath('/path/to/FILE.PDF')).not.toThrow();
  });

  it('should reject non-.pdf paths', () => {
    expect(() => validatePdfPath('/path/to/file.txt')).toThrow(PdfReaderError);
  });

  it('should reject empty paths', () => {
    expect(() => validatePdfPath('')).toThrow(PdfReaderError);
  });
});

describe('handleError', () => {
  it('should format PdfReaderError with suggestion', () => {
    const err = new PdfReaderError('Test error', 'TEST', 'Try something else');
    const msg = handleError(err);
    expect(msg).toContain('Test error');
    expect(msg).toContain('Try something else');
  });

  it('should handle file not found errors', () => {
    const err = new Error('ENOENT: no such file or directory');
    const msg = handleError(err);
    expect(msg).toContain('File not found');
  });

  it('should handle unknown errors', () => {
    const msg = handleError('string error');
    expect(msg).toContain('unexpected');
  });
});

describe('truncateIfNeeded', () => {
  it('should not truncate short text', () => {
    const { text, truncated } = truncateIfNeeded('hello');
    expect(text).toBe('hello');
    expect(truncated).toBe(false);
  });

  it('should truncate long text with notice', () => {
    const longText = 'x'.repeat(30000);
    const { text, truncated } = truncateIfNeeded(longText);
    expect(truncated).toBe(true);
    expect(text).toContain('truncated');
    expect(text.length).toBeLessThan(longText.length);
  });
});

// ── #17: page-list compression (display only) ──
describe('formatPageList', () => {
  it('collapses a consecutive run to start–end', () => {
    expect(formatPageList([1, 2, 3])).toBe('1–3');
  });

  it('comma-separates non-consecutive runs and keeps singletons bare', () => {
    expect(formatPageList([1, 2, 3, 7, 9, 10])).toBe('1–3, 7, 9–10');
  });

  it('renders a single page without a dash', () => {
    expect(formatPageList([5])).toBe('5');
  });

  it('returns an empty string for an empty list', () => {
    expect(formatPageList([])).toBe('');
  });

  // The motivating case: a Document element spanning a 1000-page PDF must not
  // render 1000 numbers. A gap (a page absent from the structure tree) stays
  // visible as a break in the run.
  it('keeps a 1000-page span with one gap to two ranges', () => {
    const pages = Array.from({ length: 1000 }, (_, i) => i + 1).filter((p) => p !== 500);
    expect(formatPageList(pages)).toBe('1–499, 501–1000');
  });
});

// ── #16: GFM cell escaping in structured-text Markdown ──
describe('formatStructuredTextMarkdown table cells', () => {
  it('escapes "|" inside cells so columns do not split (#16)', () => {
    const md = formatStructuredTextMarkdown({
      isTagged: true,
      lang: null,
      elements: [
        {
          role: 'Table',
          depth: 0,
          text: null,
          pages: [1],
          rows: [
            [
              { text: 'Name', isHeader: true },
              { text: 'Definition', isHeader: true },
            ],
            [
              { text: 'Line', isHeader: false },
              // The ISO 32000-2 Table 126 case: −|𝑦| broke the GFM row.
              { text: '−|y| { exch pop abs neg }', isHeader: false },
            ],
          ],
        },
      ],
    });
    expect(md).toContain('−\\|y\\|');
    // Header + separator + body = the table renders as three lines.
    expect(md).toContain('| Name | Definition |');
  });

  it('compresses multi-page spans in the pages annotation (#17)', () => {
    const md = formatStructuredTextMarkdown({
      isTagged: true,
      lang: null,
      elements: [
        {
          role: 'P',
          depth: 0,
          text: 'spans a lot',
          pages: [3, 4, 5, 6],
        },
      ],
    });
    expect(md).toContain('(pages 3–6)');
    expect(md).not.toContain('3–4–5–6');
  });
});
