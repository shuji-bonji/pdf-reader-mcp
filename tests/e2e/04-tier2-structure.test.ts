/**
 * 04 - Tier 2 Structure & Font Analysis E2E Tests
 *
 * IS-1〜IS-5: inspect_structure (analyzeStructure)
 * IF-1〜IF-4: inspect_fonts (analyzeFontsWithPdfLib)
 * ET-1〜:    extract_tables (extractTables)
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeFontsWithPdfLib, analyzeStructure } from '../../src/services/pdflib-service.js';
import { extractTables } from '../../src/services/struct-tree-service.js';
import type { TablesExtractionResult } from '../../src/types.js';
import { formatTablesMarkdown } from '../../src/utils/formatter.js';
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

  // ========================================
  // High-1 regression: Type0 (composite / CID) font embedding
  //
  // Type0 font dictionaries have no FontDescriptor (ISO 32000-2 Table 119);
  // it lives on the CIDFont in DescendantFonts (Table 115, "Required; shall be
  // an indirect reference"). Looking at the Type0 dictionary itself therefore
  // found nothing and reported every Type0 font as not embedded — i.e. nearly
  // every Japanese PDF, in the tool's headline "check embedding for PDF/A,
  // PDF/X" use case.
  //
  // Verified against a real NotoSansJP PDF (qpdf confirmed /FontFile2 present);
  // cid-font.pdf reproduces the same shape without shipping a CJK font binary.
  // ========================================

  // IF-5: 埋め込み済み Type0 を embedded と判定する (High-1 の回帰)
  it('IF-5: embedded Type0 font is reported as embedded', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.cidFont);
    const font = [...result.fontMap.values()].find((f) => f.name.includes('NotoSansJP'));

    expect(font).toBeDefined();
    expect(font?.type).toBe('Type0');
    // 修正前はここが false だった（FontDescriptor を Type0 辞書自体に探していたため）
    expect(font?.isEmbedded).toBe(true);
  });

  // IF-6: 非埋め込み Type0 は embedded と判定しない
  //       （「Type0 なら常に true」という過剰修正を防ぐ）
  it('IF-6: non-embedded Type0 font is not reported as embedded', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.cidFont);
    const font = [...result.fontMap.values()].find((f) => f.name.includes('KozMinPr6N'));

    expect(font).toBeDefined();
    expect(font?.type).toBe('Type0');
    // DescendantFonts は解決できるが CIDFont に FontFile* が無い
    expect(font?.isEmbedded).toBe(false);
  });

  // IF-7: DescendantFonts を欠く不正な Type0 は埋め込みを主張しない
  it('IF-7: malformed Type0 without DescendantFonts is not embedded', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.cidFont);
    const font = [...result.fontMap.values()].find((f) => f.name.includes('BrokenCID'));

    expect(font).toBeDefined();
    expect(font?.isEmbedded).toBe(false);
  });

  // IF-8: 単純フォントの経路は Type0 対応で壊れていない
  it('IF-8: simple (non-Type0) fonts still resolve their own FontDescriptor', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.cidFont);
    const helv = [...result.fontMap.values()].find((f) => f.name.includes('Helvetica'));

    expect(helv).toBeDefined();
    // standard 14 は埋め込まれない
    expect(helv?.isEmbedded).toBe(false);
    expect(helv?.type).toBe('Type1');
  });
});

// ========================================
// Linearized PDF regression (Issue #1)
//
// Linearized PDFs caused `analyzeStructure` and `analyzeFontsWithPdfLib` to
// throw `Expected instance of PDFDict, but got instance of undefined`
// because pdf-lib cannot resolve `/Linearized` hint streams. After the fix
// these functions must return a valid result instead of throwing.
//
// The fixture is generated by piping `simple.pdf` through `qpdf --linearize`
// (see `tests/fixtures/create-test-pdf.ts`). If qpdf is unavailable the
// fixture is missing and the tests are skipped.
// ========================================

const linearizedAvailable = existsSync(FIXTURES.linearized);
const describeIfLinearized = linearizedAvailable ? describe : describe.skip;

// ========================================
// extract_tables (Issue #2)
// ========================================

describe('04 - extract_tables', () => {
  // ET-1: Untagged PDF returns isTagged: false + note + empty tables
  it('ET-1: untagged simple.pdf returns isTagged=false with a note', async () => {
    const result = await extractTables(FIXTURES.simple);
    expect(result.isTagged).toBe(false);
    expect(result.tables).toEqual([]);
    expect(result.totalTables).toBe(0);
    expect(typeof result.note).toBe('string');
    expect(result.note ?? '').toMatch(/not tagged/i);
  });

  // ET-2: Tagged PDF without tables — must NOT return a note (we only set
  // it for the untagged branch).
  it('ET-2: tagged.pdf (no tables) returns isTagged=true with no note', async () => {
    const result = await extractTables(FIXTURES.tagged);
    expect(result.isTagged).toBe(true);
    expect(result.totalTables).toBe(0);
    expect(result.note).toBeUndefined();
    expect(result.pagesScanned).toBe(EXPECTED_METADATA.tagged.pageCount);
  });

  // ET-3: Markdown formatter renders an "untagged" result with the note.
  it('ET-3: formatTablesMarkdown renders the untagged note', async () => {
    const result = await extractTables(FIXTURES.simple);
    const md = formatTablesMarkdown(result);
    expect(md).toContain('# Extracted Tables');
    expect(md).toContain('**Tagged**: No');
    expect(md).toContain('## Note');
  });

  // ET-4: Markdown formatter handcrafted — verify table rendering shape.
  it('ET-4: formatTablesMarkdown emits GFM tables with header + body', () => {
    const fake: TablesExtractionResult = {
      isTagged: true,
      pagesScanned: 1,
      totalTables: 1,
      tables: [
        {
          pages: [1],
          index: 1,
          headerRows: [
            {
              cells: [
                { text: '改正後', isHeader: true },
                { text: '改正前', isHeader: true },
              ],
            },
          ],
          bodyRows: [
            {
              cells: [
                { text: 'A1', isHeader: false },
                { text: 'B1', isHeader: false },
              ],
            },
          ],
          footerRows: [],
        },
      ],
    };
    const md = formatTablesMarkdown(fake);
    expect(md).toContain('## Table 1 — Page 1');
    expect(md).toContain('| 改正後 | 改正前 |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| A1 | B1 |');
  });

  // ET-5: pages filter is honoured.
  it('ET-5: pages parameter filters scanned pages', async () => {
    const result = await extractTables(FIXTURES.tagged, '1');
    expect(result.pagesScanned).toBe(1);
  });

  // ── #14 regression: the walker moved to StructTreeRoot ──

  // ET-6: ONE Table element continuing across a page break stays ONE table.
  // The per-page walk this replaces reported two fragments (page 2's carrying
  // only the continuation row) — the "phantom table" failure mode observed on
  // ISO 32000-2 pp.383–386.
  it('ET-6: a page-spanning Table is one table with pages [1, 2]', async () => {
    const result = await extractTables(FIXTURES.spanningTable);
    expect(result.isTagged).toBe(true);
    expect(result.totalTables).toBe(1);

    const [table] = result.tables;
    expect(table.pages).toEqual([1, 2]);
    expect(table.headerRows).toHaveLength(1);
    expect(table.bodyRows).toHaveLength(2);
    // The continuation row (content on page 2) belongs to the same table.
    expect(table.bodyRows[1].cells.map((c) => c.text)).toEqual(['Costs', '60']);
  });

  // ET-7: a table touching the requested range is returned whole.
  it('ET-7: pages="2" returns the spanning table whole, not a fragment', async () => {
    const result = await extractTables(FIXTURES.spanningTable, '2');
    expect(result.totalTables).toBe(1);
    expect(result.tables[0].pages).toEqual([1, 2]);
    expect(result.tables[0].bodyRows).toHaveLength(2);
  });

  // ET-8: structured.pdf's single-page table keeps working on the new walker.
  it('ET-8: structured.pdf yields its one table with document-wide index', async () => {
    const result = await extractTables(FIXTURES.structured);
    expect(result.totalTables).toBe(1);
    expect(result.tables[0].pages).toEqual([1]);
    expect(result.tables[0].index).toBe(1);
    expect(result.tables[0].bodyRows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['Item', 'Amount'],
      ['Sales', '100'],
    ]);
  });
});

describeIfLinearized('04 - Linearized PDF (Issue #1 regression)', () => {
  it('analyzeStructure does not throw on a linearized PDF', async () => {
    const result = await analyzeStructure(FIXTURES.linearized);
    // pageTree.totalPages must be present (resolved either by pdf-lib
    // or the pdfjs-dist fallback path).
    expect(result.pageTree.totalPages).toBeGreaterThan(0);
    expect(typeof result.isEncrypted).toBe('boolean');
    expect(Array.isArray(result.catalog)).toBe(true);
  });

  it('analyzeFontsWithPdfLib does not throw on a linearized PDF', async () => {
    const result = await analyzeFontsWithPdfLib(FIXTURES.linearized);
    // We only require that the call resolves — fontMap may be empty or
    // populated depending on whether pdf-lib could traverse the page tree.
    expect(result.fontMap).toBeInstanceOf(Map);
    expect(typeof result.pagesScanned).toBe('number');
  });
});
