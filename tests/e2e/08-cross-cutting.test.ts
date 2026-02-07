/**
 * 08 - Cross-Cutting Concerns E2E Tests
 *
 * EH-1〜EH-6: エラーハンドリング & セキュリティ
 */
import { describe, expect, it } from 'vitest';
import {
  extractText,
  getMetadata,
  loadDocument,
  searchText,
} from '../../src/services/pdfjs-service.js';
import { analyzeFontsWithPdfLib, analyzeStructure } from '../../src/services/pdflib-service.js';
import { validateMetadata } from '../../src/services/validation-service.js';
import { validatePdfPath } from '../../src/utils/error-handler.js';
import { parsePageRange } from '../../src/utils/pdf-helpers.js';
import { EXPECTED_METADATA, PAGE_RANGE_CASES, SEARCH_QUERIES } from './constants.js';
import { FIXTURES, INVALID_PATHS } from './setup.js';

// ========================================
// Path validation & security
// ========================================

describe('08 - path validation', () => {
  // EH-1: 存在しないファイルパス
  it('EH-1: non-existent path throws error', async () => {
    await expect(getMetadata(INVALID_PATHS.nonExistent)).rejects.toThrow();
  });

  // EH-2: 空文字パス
  it('EH-2: empty string path throws validation error', () => {
    expect(() => validatePdfPath('')).toThrow();
  });

  // EH-3: 相対パス
  it('EH-3: relative path throws validation error', () => {
    expect(() => validatePdfPath(INVALID_PATHS.relative)).toThrow(/absolute/i);
  });

  // EH-4: ".." を含むパス
  it('EH-4: traversal path throws security error', () => {
    expect(() => validatePdfPath(INVALID_PATHS.traversal)).toThrow();
  });

  // EH-5: 非PDF拡張子
  it('EH-5: non-PDF extension throws validation error', () => {
    expect(() => validatePdfPath(INVALID_PATHS.notPdf)).toThrow(/\.pdf/i);
  });

  // EH-extra: 正常なパスは通過
  it('EH-extra: valid PDF path passes validation', () => {
    expect(() => validatePdfPath(FIXTURES.simple)).not.toThrow();
  });
});

// ========================================
// Corrupted PDF handling
// ========================================

describe('08 - corrupted PDF handling', () => {
  // EH-6: corrupted.pdf
  it('EH-6: corrupted.pdf loadDocument fails', async () => {
    await expect(loadDocument(FIXTURES.corrupted)).rejects.toThrow();
  });

  it('EH-6b: corrupted.pdf getMetadata fails', async () => {
    await expect(getMetadata(FIXTURES.corrupted)).rejects.toThrow();
  });

  it('EH-6c: corrupted.pdf analyzeStructure fails', async () => {
    await expect(analyzeStructure(FIXTURES.corrupted)).rejects.toThrow();
  });
});

// ========================================
// Page range parsing (table-driven)
// ========================================

describe('08 - parsePageRange', () => {
  for (const { input, totalPages, expected, label } of PAGE_RANGE_CASES) {
    it(label, () => {
      const result = parsePageRange(input, totalPages);
      expect(result).toEqual(expected);
    });
  }

  it('undefined → null (all pages)', () => {
    const result = parsePageRange(undefined, 5);
    expect(result).toBeNull();
  });
});

// ========================================
// Cross-service integration
// ========================================

describe('08 - cross-service integration', () => {
  // 同一ファイルを複数サービスで処理
  it('pdfjs and pdflib page counts agree', async () => {
    const [meta, structure] = await Promise.all([
      getMetadata(FIXTURES.simple),
      analyzeStructure(FIXTURES.simple),
    ]);
    expect(meta.pageCount).toBe(structure.pageTree.totalPages);
  });

  // 連続呼び出し安定性
  it('repeated getMetadata calls return consistent results', async () => {
    const results = await Promise.all([
      getMetadata(FIXTURES.simple),
      getMetadata(FIXTURES.simple),
      getMetadata(FIXTURES.simple),
    ]);
    for (const r of results) {
      expect(r.title).toBe(EXPECTED_METADATA.simple.title);
      expect(r.pageCount).toBe(EXPECTED_METADATA.simple.pageCount);
    }
  });

  // 異なるフィクスチャの交互処理
  it('alternating fixture processing is stable', async () => {
    const meta1 = await getMetadata(FIXTURES.simple);
    const meta2 = await getMetadata(FIXTURES.annotated);
    const meta3 = await getMetadata(FIXTURES.simple);

    expect(meta1.title).toBe(EXPECTED_METADATA.simple.title);
    expect(meta2.title).toBe(EXPECTED_METADATA.annotated.title);
    expect(meta3.title).toBe(EXPECTED_METADATA.simple.title);
  });

  // テキスト抽出 → 検索の組み合わせ
  it('text extraction followed by search works correctly', async () => {
    await extractText(FIXTURES.simple);
    const matches = await searchText(FIXTURES.simple, SEARCH_QUERIES.hello);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  // 全サービスの順次実行
  it('sequential execution of all services completes without crash', async () => {
    // Tier 1
    await getMetadata(FIXTURES.simple);
    await extractText(FIXTURES.simple, '1');
    await searchText(FIXTURES.simple, SEARCH_QUERIES.test);

    // Tier 2
    await analyzeStructure(FIXTURES.simple);
    await analyzeFontsWithPdfLib(FIXTURES.simple);

    // Tier 3
    await validateMetadata(FIXTURES.simple);

    expect(true).toBe(true);
  });
});
