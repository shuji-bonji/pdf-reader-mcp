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
import { EXPECTED_METADATA } from './constants.js';
import { ALL_FIXTURES, FIXTURES } from './setup.js';

// ========================================
// Page count (get_page_count)
// ========================================

describe('01 - get_page_count', () => {
  // PC-1: 全フィクスチャのページ数パラメトリックテスト
  describe('PC-1: page count for all fixtures', () => {
    for (const fixture of ALL_FIXTURES) {
      it(`${fixture.name}: expects ${fixture.pageCount} page(s)`, async () => {
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
  it('PC-5: throws on non-existent file path', async () => {
    await expect(loadDocument('/tmp/nonexistent-12345.pdf')).rejects.toThrow();
  });
});

// ========================================
// Metadata (get_metadata)
// ========================================

describe('01 - get_metadata', () => {
  // MD-1: simple.pdf のメタデータ
  it('MD-1: simple.pdf metadata is accurate', async () => {
    const meta = await getMetadata(FIXTURES.simple);
    const expected = EXPECTED_METADATA.simple;
    expect(meta.title).toBe(expected.title);
    expect(meta.author).toBe(expected.author);
    expect(meta.subject).toBe(expected.subject);
    expect(meta.creator).toBe(expected.creator);
    expect(meta.producer).toBe(expected.producer);
    expect(meta.pageCount).toBe(expected.pageCount);
  });

  // MD-2: empty.pdf のメタデータ
  it('MD-2: empty.pdf has no title or author', async () => {
    const meta = await getMetadata(FIXTURES.empty);
    expect(meta.title).toBeNull();
    expect(meta.author).toBeNull();
    expect(meta.pageCount).toBe(EXPECTED_METADATA.empty.pageCount);
  });

  // MD-3: annotated.pdf のメタデータ
  it('MD-3: annotated.pdf metadata with signature', async () => {
    const meta = await getMetadata(FIXTURES.annotated);
    const expected = EXPECTED_METADATA.annotated;
    expect(meta.title).toBe(expected.title);
    expect(meta.author).toBe(expected.author);
    expect(meta.hasSignatures).toBe(expected.hasSignatures);
  });

  // MD-4: no-metadata.pdf
  it('MD-4: no-metadata.pdf has all null metadata', async () => {
    const meta = await getMetadata(FIXTURES.noMetadata);
    expect(meta.title).toBeNull();
    expect(meta.author).toBeNull();
    expect(meta.subject).toBeNull();
    expect(meta.keywords).toBeNull();
  });

  // MD-5: 全フィクスチャで pageCount が正確
  describe('MD-5: pageCount matches for all fixtures', () => {
    for (const fixture of ALL_FIXTURES) {
      it(`${fixture.name}: pageCount=${fixture.pageCount}`, async () => {
        const meta = await getMetadata(fixture.path);
        expect(meta.pageCount).toBe(fixture.pageCount);
      });
    }
  });

  // MD-6: fileSize > 0
  describe('MD-6: fileSize > 0 for all fixtures', () => {
    for (const fixture of ALL_FIXTURES) {
      it(`${fixture.name}: fileSize > 0`, async () => {
        const meta = await getMetadata(fixture.path);
        expect(meta.fileSize).toBeGreaterThan(0);
      });
    }
  });

  // 追加: フラグの正確性
  it('MD-extra: simple.pdf flags are accurate', async () => {
    const meta = await getMetadata(FIXTURES.simple);
    const expected = EXPECTED_METADATA.simple;
    expect(meta.isEncrypted).toBe(expected.isEncrypted);
    expect(meta.isLinearized).toBe(expected.isLinearized);
    expect(meta.isTagged).toBe(expected.isTagged);
  });

  it('MD-extra: tagged.pdf has isTagged=true', async () => {
    const meta = await getMetadata(FIXTURES.tagged);
    expect(meta.isTagged).toBe(EXPECTED_METADATA.tagged.isTagged);
    expect(meta.title).toBe(EXPECTED_METADATA.tagged.title);
  });
});

// ========================================
// Summarize (統合テスト)
// ========================================

describe('01 - summarize', () => {
  // SM-1: simple.pdf のサマリー
  it('SM-1: simple.pdf summary information', async () => {
    const meta = await getMetadata(FIXTURES.simple);
    const pages = await extractText(FIXTURES.simple, '1');
    const imageCount = await countImages(FIXTURES.simple);

    expect(meta.title).toBe(EXPECTED_METADATA.simple.title);
    expect(pages.length).toBe(1);
    expect(pages[0].text.length).toBeGreaterThan(0);
    expect(imageCount).toBe(0);
  });

  // SM-2: empty.pdf
  it('SM-2: empty.pdf has no text content', async () => {
    const pages = await extractText(FIXTURES.empty);
    const hasText = pages.some((p) => p.text.trim().length > 0);
    expect(hasText).toBe(false);
  });

  // SM-3: comprehensive_1.pdf (画像あり)
  it('SM-3: comprehensive_1.pdf has images', async () => {
    const imageCount = await countImages(FIXTURES.comprehensive);
    expect(imageCount).toBeGreaterThan(0);
  });
});
