/**
 * 04 - Tier 2 Structure & Font Analysis E2E Tests
 *
 * IS-1〜IS-5: inspect_structure (analyzeStructure)
 * IF-1〜IF-4: inspect_fonts (analyzeFontsWithPdfLib)
 */
import { describe, expect, it } from 'vitest';
import { analyzeFontsWithPdfLib, analyzeStructure } from '../../src/services/pdflib-service.js';
import { ALL_FIXTURES, FIXTURES } from './setup.js';

// ========================================
// 内部構造解析 (inspect_structure)
// ========================================

describe('04 - inspect_structure', () => {
  // IS-1: simple.pdf の基本構造
  it('IS-1: simple.pdf のカタログとページツリー', async () => {
    const result = await analyzeStructure(FIXTURES.simple);
    expect(result.catalog.length).toBeGreaterThan(0);
    expect(result.pageTree.totalPages).toBe(3);
  });

  // IS-2: objectStats
  it('IS-2: objectStats が正確', async () => {
    const result = await analyzeStructure(FIXTURES.simple);
    expect(result.objectStats.totalObjects).toBeGreaterThan(0);
    expect(result.objectStats.streamCount).toBeGreaterThanOrEqual(0);
    expect(typeof result.objectStats.byType).toBe('object');
  });

  // IS-3: pdfVersion 検出
  it('IS-3: pdfVersion が検出される', async () => {
    const result = await analyzeStructure(FIXTURES.simple);
    expect(result.pdfVersion).not.toBeNull();
    // pdf-lib は 1.7 で生成
    expect(result.pdfVersion).toMatch(/^\d+\.\d+$/);
  });

  // IS-4: mediaBoxSamples (A4サイズ)
  it('IS-4: mediaBoxSamples が A4 サイズ', async () => {
    const result = await analyzeStructure(FIXTURES.simple);
    expect(result.pageTree.mediaBoxSamples.length).toBeGreaterThan(0);
    const sample = result.pageTree.mediaBoxSamples[0];
    expect(sample.page).toBe(1);
    // A4: 595 x 842 pt
    expect(sample.width).toBeCloseTo(595, 0);
    expect(sample.height).toBeCloseTo(842, 0);
  });

  // IS-5: 暗号化フラグ
  it('IS-5: 全フィクスチャで isEncrypted=false', async () => {
    for (const fixture of ALL_FIXTURES) {
      const result = await analyzeStructure(fixture.path);
      expect(result.isEncrypted).toBe(false);
    }
  });

  // IS-extra: 全フィクスチャのページ数一致
  describe('IS-extra: 全フィクスチャの pageTree.totalPages', () => {
    for (const fixture of ALL_FIXTURES) {
      it(`${fixture.name}: totalPages=${fixture.pageCount}`, async () => {
        const result = await analyzeStructure(fixture.path);
        expect(result.pageTree.totalPages).toBe(fixture.pageCount);
      });
    }
  });

  // IS-extra: カタログエントリの構造
  it('IS-extra: カタログエントリの key, type, value が存在', async () => {
    const result = await analyzeStructure(FIXTURES.simple);
    for (const entry of result.catalog) {
      expect(typeof entry.key).toBe('string');
      expect(typeof entry.type).toBe('string');
      expect(typeof entry.value).toBe('string');
    }
  });

  // IS-extra: annotated.pdf の AcroForm カタログエントリ
  it('IS-extra: annotated.pdf に AcroForm カタログエントリ', async () => {
    const result = await analyzeStructure(FIXTURES.annotated);
    const hasAcroForm = result.catalog.some((e) => e.key === 'AcroForm');
    expect(hasAcroForm).toBe(true);
  });

  // IS-extra: tagged.pdf に MarkInfo と StructTreeRoot
  it('IS-extra: tagged.pdf に MarkInfo と StructTreeRoot', async () => {
    const result = await analyzeStructure(FIXTURES.tagged);
    const hasMarkInfo = result.catalog.some((e) => e.key === 'MarkInfo');
    const hasStructTreeRoot = result.catalog.some((e) => e.key === 'StructTreeRoot');
    expect(hasMarkInfo).toBe(true);
    expect(hasStructTreeRoot).toBe(true);
  });
});

// ========================================
// フォント解析 (inspect_fonts)
// ========================================

describe('04 - inspect_fonts', () => {
  // IF-1: simple.pdf
  it('IF-1: simple.pdf に Helvetica フォント', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.simple);
    const fontNames = [...result.fontMap.keys()];
    expect(fontNames.some((n) => n.includes('Helvetica'))).toBe(true);
  });

  // IF-2: multi-font.pdf (3種以上)
  it('IF-2: multi-font.pdf に 3 種以上のフォント', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.multiFont);
    expect(result.fontMap.size).toBeGreaterThanOrEqual(3);

    const fontNames = [...result.fontMap.keys()];
    // Helvetica, TimesRoman, Courier の各系統が存在
    expect(fontNames.some((n) => n.includes('Helvetica'))).toBe(true);
    expect(fontNames.some((n) => n.includes('Times'))).toBe(true);
    expect(fontNames.some((n) => n.includes('Courier'))).toBe(true);
  });

  // IF-3: フォントプロパティの正確性
  it('IF-3: フォントプロパティが正確', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.simple);
    for (const [_name, font] of result.fontMap) {
      expect(typeof font.name).toBe('string');
      expect(typeof font.type).toBe('string');
      expect(Array.isArray(font.pagesUsed)).toBe(true);
      expect(font.pagesUsed.length).toBeGreaterThan(0);
      expect(typeof font.isEmbedded).toBe('boolean');
      expect(typeof font.isSubset).toBe('boolean');
    }
  });

  // IF-4: 全ページスキャン
  it('IF-4: pagesScanned = 総ページ数', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.simple);
    expect(result.pagesScanned).toBe(3);

    const result2 = await analyzeFontsWithPdfLib(FIXTURES.multiFont);
    expect(result2.pagesScanned).toBe(2);
  });

  // IF-extra: multi-font の pagesUsed が正確
  it('IF-extra: multi-font.pdf でフォントの pagesUsed が正確', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.multiFont);
    // Helvetica は page 1 に存在
    for (const [_name, font] of result.fontMap) {
      for (const pageNum of font.pagesUsed) {
        expect(pageNum).toBeGreaterThanOrEqual(1);
        expect(pageNum).toBeLessThanOrEqual(2);
      }
    }
  });

  // IF-extra: empty.pdf のフォント (フォントなしの可能性)
  it('IF-extra: empty.pdf のフォント解析', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.empty);
    // 空白ページなのでフォントなし
    expect(result.fontMap.size).toBe(0);
    expect(result.pagesScanned).toBe(1);
  });
});
