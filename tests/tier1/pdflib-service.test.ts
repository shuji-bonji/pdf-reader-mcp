/**
 * Tests for pdflib-service.ts
 */

import { describe, expect, it } from 'vitest';
import { resolvePdfVersion } from '../../src/services/pdflib-service.js';

// D-8 regression: analyzeStructure returned the catalog's /Version whenever it
// existed, ignoring the file header.
//
// ISO 32000-2 Table 29 (Version) makes the catalog entry conditional: it is the
// version the document conforms to "if later than the version specified in the
// file's header. If the header specifies a later version, or if this entry is
// absent, the document shall conform to the version specified in the header."
describe('resolvePdfVersion', () => {
  it('takes the catalog version when it is later than the header', () => {
    // Table 29 の主目的: 増分更新で版を上げる (§7.5.6)
    expect(resolvePdfVersion('1.4', '1.7')).toBe('1.7');
    expect(resolvePdfVersion('1.4', '2.0')).toBe('2.0');
  });

  it('takes the header version when the header is later', () => {
    // 旧実装はここで catalog の 1.4 を返していた
    expect(resolvePdfVersion('1.7', '1.4')).toBe('1.7');
    expect(resolvePdfVersion('2.0', '1.7')).toBe('2.0');
  });

  it('takes the header version when both are equal', () => {
    // catalog は「later」ではないので header に従う
    expect(resolvePdfVersion('1.7', '1.7')).toBe('1.7');
  });

  it('takes the header version when the catalog entry is absent', () => {
    expect(resolvePdfVersion('1.7', null)).toBe('1.7');
  });

  it('compares the minor part numerically, not lexically', () => {
    // 文字列比較だと '1.10' < '1.7' となり誤る
    expect(resolvePdfVersion('1.7', '1.10')).toBe('1.10');
    expect(resolvePdfVersion('1.10', '1.7')).toBe('1.10');
  });

  it('falls back to the catalog version when the header cannot be read', () => {
    expect(resolvePdfVersion(null, '1.4')).toBe('1.4');
  });

  it('ignores a malformed catalog entry', () => {
    // 不正な値は「later を指定している」と示せないので header が勝つ
    expect(resolvePdfVersion('1.7', 'garbage')).toBe('1.7');
    expect(resolvePdfVersion(null, 'garbage')).toBeNull();
  });

  it('returns null when neither version is available', () => {
    expect(resolvePdfVersion(null, null)).toBeNull();
  });
});
