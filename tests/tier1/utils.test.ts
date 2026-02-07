/**
 * Tests for utility modules.
 */

import { describe, expect, it } from 'vitest';
import { handleError, PdfReaderError, validatePdfPath } from '../../src/utils/error-handler.js';
import { truncateIfNeeded } from '../../src/utils/formatter.js';
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

  it('should clamp range to total pages', () => {
    expect(parsePageRange('1-100', 5)).toEqual([1, 2, 3, 4, 5]);
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
