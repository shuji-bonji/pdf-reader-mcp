/**
 * 01 - Tier 1 Basic Operations E2E Tests
 *
 * PC-1〜PC-5: get_page_count (loadDocument + numPages)
 * MD-1〜MD-6: get_metadata
 * SM-1〜SM-3: summarize
 */
import { describe, expect, it } from 'vitest';
import {
  countImages,
  extractText,
  getMetadata,
  loadDocument,
} from '../../src/services/pdfjs-service.js';
import { ALL_FIXTURES, FIXTURES } from './setup.js';

// ========================================
// ページ数取得
// ========================================

describe('01 - get_page_count', () => {
  // PC-1: 全フィクスチャのページ数パラメトリックテスト
  describe('PC-1: 全フィクスチャのページ数検証', () => {
    for (const fixture of ALL_FIXTURES) {
      it(`${fixture.name}: ${fixture.pageCount} ページ`, async () => {
        const doc = await loadDocument(fixture.path);
        try {
          expect(doc.numPages).toBe(fixture.pageCount);
        } finally {
          await doc.destroy();
        }
      });
    }
  });

  // PC-5: 存在しないファイルパス
  it('PC-5: 存在しないファイルパスでエラー', async () => {
    await expect(loadDocument('/tmp/nonexistent-12345.pdf')).rejects.toThrow();
  });
});

// ========================================
// メタデータ取得
// ========================================

describe('01 - get_metadata', () => {
  // MD-1: simple.pdf のメタデータ
  it('MD-1: simple.pdf のメタデータが正確', async () => {
    const meta = await getMetadata(FIXTURES.simple);
    expect(meta.title).toBe('Test PDF Document');
    expect(meta.author).toBe('pdf-reader-mcp');
    expect(meta.subject).toBe('Test fixture');
    expect(meta.creator).toBe('pdf-lib');
    expect(meta.producer).toBe('pdf-reader-mcp test suite');
    expect(meta.pageCount).toBe(3);
  });

  // MD-2: empty.pdf のメタデータ
  it('MD-2: empty.pdf のメタデータ (タイトルなし)', async () => {
    const meta = await getMetadata(FIXTURES.empty);
    expect(meta.title).toBeNull();
    expect(meta.author).toBeNull();
    expect(meta.pageCount).toBe(1);
  });

  // MD-3: annotated.pdf のメタデータ
  it('MD-3: annotated.pdf のメタデータ (署名フィールド付き)', async () => {
    const meta = await getMetadata(FIXTURES.annotated);
    expect(meta.title).toBe('Annotated Test PDF');
    expect(meta.author).toBe('pdf-reader-mcp');
    expect(meta.hasSignatures).toBe(true);
  });

  // MD-4: no-metadata.pdf
  it('MD-4: no-metadata.pdf (全メタデータなし)', async () => {
    const meta = await getMetadata(FIXTURES.noMetadata);
    expect(meta.title).toBeNull();
    expect(meta.author).toBeNull();
    expect(meta.subject).toBeNull();
    expect(meta.keywords).toBeNull();
  });

  // MD-5: 全フィクスチャで pageCount が正確
  describe('MD-5: 全フィクスチャの pageCount 検証', () => {
    for (const fixture of ALL_FIXTURES) {
      it(`${fixture.name}: pageCount=${fixture.pageCount}`, async () => {
        const meta = await getMetadata(fixture.path);
        expect(meta.pageCount).toBe(fixture.pageCount);
      });
    }
  });

  // MD-6: fileSize > 0
  describe('MD-6: 全フィクスチャで fileSize > 0', () => {
    for (const fixture of ALL_FIXTURES) {
      it(`${fixture.name}: fileSize > 0`, async () => {
        const meta = await getMetadata(fixture.path);
        expect(meta.fileSize).toBeGreaterThan(0);
      });
    }
  });

  // 追加: isEncrypted / isTagged / isLinearized フラグ
  it('MD-extra: simple.pdf のフラグが正確', async () => {
    const meta = await getMetadata(FIXTURES.simple);
    expect(meta.isEncrypted).toBe(false);
    expect(meta.isLinearized).toBe(false);
    expect(meta.isTagged).toBe(false);
  });

  it('MD-extra: tagged.pdf のタグフラグ', async () => {
    const meta = await getMetadata(FIXTURES.tagged);
    expect(meta.isTagged).toBe(true);
    expect(meta.title).toBe('Tagged PDF Document');
  });
});

// ========================================
// サマリー (summarize 相当の統合テスト)
// ========================================

describe('01 - summarize', () => {
  // SM-1: simple.pdf のサマリー
  it('SM-1: simple.pdf のサマリー情報', async () => {
    const meta = await getMetadata(FIXTURES.simple);
    const pages = await extractText(FIXTURES.simple, '1');
    const imageCount = await countImages(FIXTURES.simple);

    expect(meta.title).toBe('Test PDF Document');
    expect(pages.length).toBe(1);
    expect(pages[0].text.length).toBeGreaterThan(0);
    expect(imageCount).toBe(0);
  });

  // SM-2: empty.pdf
  it('SM-2: empty.pdf のサマリー情報', async () => {
    const pages = await extractText(FIXTURES.empty);
    const hasText = pages.some((p) => p.text.trim().length > 0);
    expect(hasText).toBe(false);
  });

  // SM-3: comprehensive_1.pdf (画像あり)
  it('SM-3: comprehensive_1.pdf の画像カウント', async () => {
    const imageCount = await countImages(FIXTURES.comprehensive);
    expect(imageCount).toBeGreaterThan(0);
  });
});
