/**
 * 04 - Tier 2 Structure & Font Analysis E2E Tests
 *
 * IS-1〜IS-5: inspect_structure (analyzeStructure)
 * IF-1〜IF-4: inspect_fonts (analyzeFontsWithPdfLib)
 */
import { describe, expect, it } from 'vitest';
import { analyzeFontsWithPdfLib, analyzeStructure } from '../../src/services/pdflib-service.js';
import { A4_SIZE, EXPECTED_METADATA, FONT_FAMILIES } from './constants.js';
import { ALL_FIXTURES, FIXTURES } from './setup.js';

// ========================================
// Internal structure (inspect_structure)
// ========================================

describe('04 - inspect_structure', () => {
  // IS-1: simple.pdf の基本構造
  it('IS-1: simple.pdf catalog and page tree', async () => {
    const result = await analyzeStructure(FIXTURES.simple);
    expect(result.catalog.length).toBeGreaterThan(0);
    expect(result.pageTree.totalPages).toBe(EXPECTED_METADATA.simple.pageCount);
  });

  // IS-2: objectStats
  it('IS-2: objectStats are populated', async () => {
    const result = await analyzeStructure(FIXTURES.simple);
    expect(result.objectStats.totalObjects).toBeGreaterThan(0);
    expect(result.objectStats.streamCount).toBeGreaterThanOrEqual(0);
    expect(typeof result.objectStats.byType).toBe('object');
  });

  // IS-3: pdfVersion 検出
  it('IS-3: pdfVersion is detected', async () => {
    const result = await analyzeStructure(FIXTURES.simple);
    expect(result.pdfVersion).not.toBeNull();
    // pdf-lib は 1.7 で生成
    expect(result.pdfVersion).toMatch(/^\d+\.\d+$/);
  });

  // IS-4: mediaBoxSamples (A4サイズ)
  it('IS-4: mediaBoxSamples match A4 dimensions', async () => {
    const result = await analyzeStructure(FIXTURES.simple);
    expect(result.pageTree.mediaBoxSamples.length).toBeGreaterThan(0);
    const sample = result.pageTree.mediaBoxSamples[0];
    expect(sample.page).toBe(1);
    expect(sample.width).toBeCloseTo(A4_SIZE.width, 0);
    expect(sample.height).toBeCloseTo(A4_SIZE.height, 0);
  });

  // IS-5: 暗号化フラグ
  it('IS-5: all fixtures are not encrypted', async () => {
    for (const fixture of ALL_FIXTURES) {
      const result = await analyzeStructure(fixture.path);
      expect(result.isEncrypted).toBe(false);
    }
  });

  // IS-extra: 全フィクスチャのページ数一致
  describe('IS-extra: pageTree.totalPages for all fixtures', () => {
    for (const fixture of ALL_FIXTURES) {
      it(`${fixture.name}: totalPages=${fixture.pageCount}`, async () => {
        const result = await analyzeStructure(fixture.path);
        expect(result.pageTree.totalPages).toBe(fixture.pageCount);
      });
    }
  });

  // IS-extra: カタログエントリの構造
  it('IS-extra: catalog entries have key, type, value', async () => {
    const result = await analyzeStructure(FIXTURES.simple);
    for (const entry of result.catalog) {
      expect(typeof entry.key).toBe('string');
      expect(typeof entry.type).toBe('string');
      expect(typeof entry.value).toBe('string');
    }
  });

  // IS-extra: annotated.pdf の AcroForm カタログエントリ
  it('IS-extra: annotated.pdf has AcroForm catalog entry', async () => {
    const result = await analyzeStructure(FIXTURES.annotated);
    const hasAcroForm = result.catalog.some((e) => e.key === 'AcroForm');
    expect(hasAcroForm).toBe(true);
  });

  // IS-extra: tagged.pdf に MarkInfo と StructTreeRoot
  it('IS-extra: tagged.pdf has MarkInfo and StructTreeRoot', async () => {
    const result = await analyzeStructure(FIXTURES.tagged);
    const hasMarkInfo = result.catalog.some((e) => e.key === 'MarkInfo');
    const hasStructTreeRoot = result.catalog.some((e) => e.key === 'StructTreeRoot');
    expect(hasMarkInfo).toBe(true);
    expect(hasStructTreeRoot).toBe(true);
  });
});

// ========================================
// Font analysis (inspect_fonts)
// ========================================

describe('04 - inspect_fonts', () => {
  // IF-1: simple.pdf
  it('IF-1: simple.pdf has Helvetica font', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.simple);
    const fontNames = [...result.fontMap.keys()];
    expect(fontNames.some((n) => n.includes(FONT_FAMILIES.helvetica))).toBe(true);
  });

  // IF-2: multi-font.pdf (3種以上)
  it('IF-2: multi-font.pdf has 3+ font families', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.multiFont);
    expect(result.fontMap.size).toBeGreaterThanOrEqual(3);

    const fontNames = [...result.fontMap.keys()];
    // Helvetica, TimesRoman, Courier の各系統が存在
    for (const family of Object.values(FONT_FAMILIES)) {
      expect(fontNames.some((n) => n.includes(family))).toBe(true);
    }
  });

  // IF-3: フォントプロパティの正確性
  it('IF-3: font properties are valid', async () => {
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
  it('IF-4: pagesScanned equals total page count', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.simple);
    expect(result.pagesScanned).toBe(EXPECTED_METADATA.simple.pageCount);

    const result2 = await analyzeFontsWithPdfLib(FIXTURES.multiFont);
    expect(result2.pagesScanned).toBe(EXPECTED_METADATA.multiFont.pageCount);
  });

  // IF-extra: multi-font の pagesUsed が正確
  it('IF-extra: multi-font.pdf font pagesUsed within range', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.multiFont);
    const maxPage = EXPECTED_METADATA.multiFont.pageCount;
    for (const [_name, font] of result.fontMap) {
      for (const pageNum of font.pagesUsed) {
        expect(pageNum).toBeGreaterThanOrEqual(1);
        expect(pageNum).toBeLessThanOrEqual(maxPage);
      }
    }
  });

  // IF-extra: empty.pdf のフォント (フォントなしの可能性)
  it('IF-extra: empty.pdf has no fonts', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.empty);
    expect(result.fontMap.size).toBe(0);
    expect(result.pagesScanned).toBe(EXPECTED_METADATA.empty.pageCount);
  });
});
