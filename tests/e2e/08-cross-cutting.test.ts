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
import { FIXTURES, INVALID_PATHS } from './setup.js';

// ========================================
// パスバリデーション & セキュリティ
// ========================================

describe('08 - パスバリデーション', () => {
  // EH-1: 存在しないファイルパス
  it('EH-1: 存在しないファイルパスでエラー', async () => {
    await expect(getMetadata(INVALID_PATHS.nonExistent)).rejects.toThrow();
  });

  // EH-2: 空文字パス
  it('EH-2: 空文字パスでバリデーションエラー', () => {
    expect(() => validatePdfPath('')).toThrow();
  });

  // EH-3: 相対パス
  it('EH-3: 相対パスでバリデーションエラー', () => {
    expect(() => validatePdfPath('tests/fixtures/simple.pdf')).toThrow(/absolute/i);
  });

  // EH-4: ".." を含むパス
  it('EH-4: ".." を含むパスでセキュリティエラー', () => {
    expect(() => validatePdfPath('/tmp/../etc/passwd')).toThrow();
  });

  // EH-5: 非PDF拡張子
  it('EH-5: .txt 拡張子でバリデーションエラー', () => {
    expect(() => validatePdfPath('/tmp/test-file.txt')).toThrow(/\.pdf/i);
  });

  // EH-extra: 正常なパスは通過
  it('EH-extra: 正常な PDF パスは通過', () => {
    expect(() => validatePdfPath(FIXTURES.simple)).not.toThrow();
  });
});

// ========================================
// 壊れたPDFの処理
// ========================================

describe('08 - 壊れたPDFの処理', () => {
  // EH-6: corrupted.pdf
  it('EH-6: corrupted.pdf でパース失敗', async () => {
    await expect(loadDocument(FIXTURES.corrupted)).rejects.toThrow();
  });

  it('EH-6b: corrupted.pdf の getMetadata でエラー', async () => {
    await expect(getMetadata(FIXTURES.corrupted)).rejects.toThrow();
  });

  it('EH-6c: corrupted.pdf の analyzeStructure でエラー', async () => {
    await expect(analyzeStructure(FIXTURES.corrupted)).rejects.toThrow();
  });
});

// ========================================
// ページ範囲パース
// ========================================

describe('08 - parsePageRange', () => {
  it('単一ページ "2" → [2]', () => {
    const result = parsePageRange('2', 5);
    expect(result).toEqual([2]);
  });

  it('範囲 "1-3" → [1, 2, 3]', () => {
    const result = parsePageRange('1-3', 5);
    expect(result).toEqual([1, 2, 3]);
  });

  it('複合 "1,3,5" → [1, 3, 5]', () => {
    const result = parsePageRange('1,3,5', 5);
    expect(result).toEqual([1, 3, 5]);
  });

  it('混合 "1,3-5" → [1, 3, 4, 5]', () => {
    const result = parsePageRange('1,3-5', 5);
    expect(result).toEqual([1, 3, 4, 5]);
  });

  it('重複排除と並び替え "3,1,2,1" → [1, 2, 3]', () => {
    const result = parsePageRange('3,1,2,1', 5);
    expect(result).toEqual([1, 2, 3]);
  });

  it('undefined → null (全ページ指定)', () => {
    const result = parsePageRange(undefined, 5);
    expect(result).toBeNull();
  });
});

// ========================================
// サービス横断テスト
// ========================================

describe('08 - サービス横断テスト', () => {
  // 同一ファイルを複数サービスで処理
  it('同一ファイルを pdfjs と pdflib で同時処理', async () => {
    const [meta, structure] = await Promise.all([
      getMetadata(FIXTURES.simple),
      analyzeStructure(FIXTURES.simple),
    ]);

    // ページ数が一致
    expect(meta.pageCount).toBe(structure.pageTree.totalPages);
  });

  // 連続呼び出し安定性
  it('同一ファイルの連続メタデータ取得が安定', async () => {
    const results = await Promise.all([
      getMetadata(FIXTURES.simple),
      getMetadata(FIXTURES.simple),
      getMetadata(FIXTURES.simple),
    ]);

    // 全て同じ結果
    for (const r of results) {
      expect(r.title).toBe('Test PDF Document');
      expect(r.pageCount).toBe(3);
    }
  });

  // 異なるフィクスチャの交互処理
  it('異なるフィクスチャの交互処理が正常', async () => {
    const meta1 = await getMetadata(FIXTURES.simple);
    const meta2 = await getMetadata(FIXTURES.annotated);
    const meta3 = await getMetadata(FIXTURES.simple);

    expect(meta1.title).toBe('Test PDF Document');
    expect(meta2.title).toBe('Annotated Test PDF');
    expect(meta3.title).toBe('Test PDF Document');
  });

  // テキスト抽出 → 検索の組み合わせ
  it('テキスト抽出後に検索が正常動作', async () => {
    await extractText(FIXTURES.simple);
    const matches = await searchText(FIXTURES.simple, 'Hello');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  // 全サービスの順次実行
  it('全サービスの順次実行でクラッシュしない', async () => {
    // Tier 1
    await getMetadata(FIXTURES.simple);
    await extractText(FIXTURES.simple, '1');
    await searchText(FIXTURES.simple, 'test');

    // Tier 2
    await analyzeStructure(FIXTURES.simple);
    await analyzeFontsWithPdfLib(FIXTURES.simple);

    // Tier 3
    await validateMetadata(FIXTURES.simple);

    // 正常終了
    expect(true).toBe(true);
  });
});
