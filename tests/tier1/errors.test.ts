/**
 * Tests for src/errors.ts and handleStructuredError() in src/utils/error-handler.ts
 *
 * houki-hub family-compatible 構造化エラー応答のテスト。
 */

import { describe, expect, it } from 'vitest';
import { isLawServiceError, makeError, NEXT_ACTIONS } from '../../src/errors.js';
import { handleStructuredError, PdfReaderError } from '../../src/utils/error-handler.js';

describe('makeError', () => {
  it('should create a minimal error with just code and message', () => {
    const err = makeError('INVALID_PDF', 'Bad PDF');
    expect(err).toEqual({ error: 'Bad PDF', code: 'INVALID_PDF' });
  });

  it('should include optional fields when provided', () => {
    const err = makeError('SOURCE_TIMEOUT', 'timeout', {
      hint: 'try again',
      next_actions: [NEXT_ACTIONS.retryLater()],
      retryable: true,
      detail: { url: 'https://example.com', cause: 'AbortError' },
    });
    expect(err.hint).toBe('try again');
    expect(err.retryable).toBe(true);
    expect(err.next_actions).toHaveLength(1);
    expect(err.next_actions?.[0].action).toBe('retry_later');
    expect(err.detail?.url).toBe('https://example.com');
  });

  it('should omit empty next_actions array', () => {
    const err = makeError('INVALID_PDF', 'x', { next_actions: [] });
    expect(err.next_actions).toBeUndefined();
  });
});

describe('isLawServiceError', () => {
  it('should return true for valid LawServiceError', () => {
    expect(isLawServiceError(makeError('INVALID_PDF', 'x'))).toBe(true);
  });

  it('should return false for plain objects', () => {
    expect(isLawServiceError({ error: 'x' })).toBe(false);
    expect(isLawServiceError({ code: 'x' })).toBe(false);
    expect(isLawServiceError(null)).toBe(false);
    expect(isLawServiceError('string')).toBe(false);
    expect(isLawServiceError(undefined)).toBe(false);
  });
});

describe('NEXT_ACTIONS presets', () => {
  it('checkFilePath includes file_path example when provided', () => {
    const a = NEXT_ACTIONS.checkFilePath('/foo.pdf');
    expect(a.action).toBe('verify_file_path');
    expect(a.example).toEqual({ file_path: '/foo.pdf' });
  });

  it('checkFilePath omits example when not provided', () => {
    const a = NEXT_ACTIONS.checkFilePath();
    expect(a.action).toBe('verify_file_path');
    expect(a.example).toBeUndefined();
  });

  it('splitPdf returns correct action', () => {
    expect(NEXT_ACTIONS.splitPdf().action).toBe('split_pdf');
  });

  it('retryLater returns correct action', () => {
    expect(NEXT_ACTIONS.retryLater().action).toBe('retry_later');
  });
});

describe('handleStructuredError - PdfReaderError mapping', () => {
  it('maps legacy MISSING_PATH to INVALID_ARGUMENT', () => {
    const err = handleStructuredError(
      new PdfReaderError('File path is required.', 'MISSING_PATH', 'Provide a path.'),
    );
    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(err.error).toBe('File path is required.');
    expect(err.hint).toBe('Provide a path.');
    expect(err.next_actions?.[0].action).toBe('verify_file_path');
  });

  it('maps legacy INVALID_URL to INVALID_ARGUMENT with checkUrl', () => {
    const err = handleStructuredError(
      new PdfReaderError('Invalid URL', 'INVALID_URL', 'Use HTTP/HTTPS'),
    );
    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(err.next_actions?.[0].action).toBe('verify_url');
  });

  it('maps legacy FILE_TOO_LARGE to FILE_TOO_LARGE', () => {
    const err = handleStructuredError(new PdfReaderError('Too big', 'FILE_TOO_LARGE'));
    expect(err.code).toBe('FILE_TOO_LARGE');
    expect(err.next_actions?.[0].action).toBe('split_pdf');
  });

  it('maps legacy FETCH_FAILED to SOURCE_API_ERROR', () => {
    const err = handleStructuredError(new PdfReaderError('HTTP 500', 'FETCH_FAILED'));
    expect(err.code).toBe('SOURCE_API_ERROR');
    expect(err.next_actions?.[0].action).toBe('retry_later');
  });

  it('maps unknown legacy code to INTERNAL_ERROR', () => {
    const err = handleStructuredError(new PdfReaderError('weird', 'NEVER_SEEN_BEFORE'));
    expect(err.code).toBe('INTERNAL_ERROR');
  });

  it('uses familyCode directly when provided', () => {
    const e = new PdfReaderError(
      'msg',
      'LEGACY',
      undefined,
      'ENCRYPTED_PDF',
      [NEXT_ACTIONS.retryLater()],
      false,
      { url: 'https://x' },
    );
    const err = handleStructuredError(e);
    expect(err.code).toBe('ENCRYPTED_PDF');
    expect(err.retryable).toBe(false);
    expect(err.detail?.url).toBe('https://x');
    expect(err.next_actions?.[0].action).toBe('retry_later');
  });
});

describe('handleStructuredError - inference from generic Error', () => {
  it('infers DOC_NOT_FOUND from ENOENT', () => {
    const err = handleStructuredError(new Error('ENOENT: no such file or directory'));
    expect(err.code).toBe('DOC_NOT_FOUND');
    expect(err.error).toBe('File not found.');
    expect(err.next_actions?.[0].action).toBe('verify_file_path');
  });

  it('infers INTERNAL_ERROR with permission hint from EACCES', () => {
    const err = handleStructuredError(new Error('EACCES: permission denied'));
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.error).toBe('Permission denied.');
  });

  it('infers INVALID_PDF from "Invalid PDF"', () => {
    const err = handleStructuredError(new Error('Invalid PDF structure'));
    expect(err.code).toBe('INVALID_PDF');
    expect(err.next_actions?.[0].action).toBe('inspect_structure');
  });

  it('infers ENCRYPTED_PDF from "password"', () => {
    const err = handleStructuredError(new Error('password required'));
    expect(err.code).toBe('ENCRYPTED_PDF');
  });

  it('infers FILE_TOO_LARGE from "too large"', () => {
    const err = handleStructuredError(new Error('file too large'));
    expect(err.code).toBe('FILE_TOO_LARGE');
    expect(err.next_actions?.[0].action).toBe('split_pdf');
  });

  it('infers SOURCE_UNAVAILABLE from ECONNREFUSED', () => {
    const err = handleStructuredError(new Error('connect ECONNREFUSED 127.0.0.1:80'));
    expect(err.code).toBe('SOURCE_UNAVAILABLE');
    expect(err.retryable).toBe(true);
  });

  it('infers SOURCE_TIMEOUT from AbortError', () => {
    const err = handleStructuredError(new Error('AbortError: signal is aborted'));
    expect(err.code).toBe('SOURCE_TIMEOUT');
    expect(err.retryable).toBe(true);
  });

  it('falls back to INTERNAL_ERROR for unrecognized Error', () => {
    const err = handleStructuredError(new Error('something weird happened'));
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.error).toBe('something weird happened');
  });

  it('falls back to INTERNAL_ERROR for non-Error values', () => {
    const err = handleStructuredError('plain string');
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.error).toContain('plain string');
  });
});

describe('handleStructuredError - shape compliance', () => {
  it('produces output that satisfies isLawServiceError', () => {
    const err = handleStructuredError(new Error('Invalid PDF'));
    expect(isLawServiceError(err)).toBe(true);
  });

  it('JSON-stringifies cleanly (no circular refs)', () => {
    const err = handleStructuredError(new Error('ENOENT: missing'));
    expect(() => JSON.stringify(err)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(err));
    expect(parsed.code).toBe('DOC_NOT_FOUND');
    expect(parsed.next_actions?.[0].action).toBe('verify_file_path');
  });
});
