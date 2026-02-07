/**
 * 07 - Tier 3 Structure Comparison E2E Tests
 *
 * CS-1〜CS-4: compare_structure
 */
import { describe, expect, it } from 'vitest';
import { compareStructure } from '../../src/services/validation-service.js';
import { FIXTURES } from './setup.js';

describe('07 - compare_structure', () => {
  // CS-1: 同一ファイル比較
  it('CS-1: simple vs simple → 全プロパティ match', async () => {
    const result = await compareStructure(FIXTURES.simple, FIXTURES.simple);
    expect(result.file1).toBe('simple.pdf');
    expect(result.file2).toBe('simple.pdf');

    // 全 diff が match
    for (const diff of result.diffs) {
      expect(diff.status).toBe('match');
    }
    expect(result.summary).toMatch(/match/i);
  });

  // CS-2: simple vs empty (差異あり)
  it('CS-2: simple vs empty → differ 多数', async () => {
    const result = await compareStructure(FIXTURES.simple, FIXTURES.empty);
    expect(result.file1).toBe('simple.pdf');
    expect(result.file2).toBe('empty.pdf');

    // ページ数が異なる
    const pageCountDiff = result.diffs.find((d) => d.property === 'Page Count');
    expect(pageCountDiff).toBeDefined();
    expect(pageCountDiff?.status).toBe('differ');
    expect(pageCountDiff?.file1Value).toBe('3');
    expect(pageCountDiff?.file2Value).toBe('1');

    // differ が存在
    const differCount = result.diffs.filter((d) => d.status === 'differ').length;
    expect(differCount).toBeGreaterThan(0);
  });

  // CS-3: フォント比較
  it('CS-3: simple vs multi-font → フォント差異', async () => {
    const result = await compareStructure(FIXTURES.simple, FIXTURES.multiFont);

    // fontComparison が存在
    expect(result.fontComparison).toBeDefined();
    expect(Array.isArray(result.fontComparison.onlyInFile1)).toBe(true);
    expect(Array.isArray(result.fontComparison.onlyInFile2)).toBe(true);
    expect(Array.isArray(result.fontComparison.inBoth)).toBe(true);

    // multi-font には追加フォントがある
    // inBoth に Helvetica が含まれるはず (両方使用)
    expect(result.fontComparison.inBoth.some((f) => f.includes('Helvetica'))).toBe(true);
    // onlyInFile2 に Times/Courier 系があるはず
    expect(result.fontComparison.onlyInFile2.length).toBeGreaterThan(0);
  });

  // CS-4: summary の生成
  it('CS-4: summary に差異数が含まれる', async () => {
    const result = await compareStructure(FIXTURES.simple, FIXTURES.empty);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary).toMatch(/difference|differ/i);
  });

  // CS-extra: diff エントリの構造
  it('CS-extra: diff エントリの構造が正確', async () => {
    const result = await compareStructure(FIXTURES.simple, FIXTURES.annotated);
    for (const diff of result.diffs) {
      expect(typeof diff.property).toBe('string');
      expect(typeof diff.file1Value).toBe('string');
      expect(typeof diff.file2Value).toBe('string');
      expect(['match', 'differ']).toContain(diff.status);
    }
  });

  // CS-extra: 比較するプロパティの網羅性
  it('CS-extra: 10項目以上のプロパティを比較', async () => {
    const result = await compareStructure(FIXTURES.simple, FIXTURES.annotated);
    expect(result.diffs.length).toBeGreaterThanOrEqual(10);

    // 主要プロパティの存在確認
    const properties = result.diffs.map((d) => d.property);
    expect(properties).toContain('Page Count');
    expect(properties).toContain('PDF Version');
    expect(properties).toContain('Encrypted');
    expect(properties).toContain('Tagged');
    expect(properties).toContain('Total Objects');
    expect(properties).toContain('File Size');
  });

  // CS-extra: annotated vs tagged (署名 vs タグ)
  it('CS-extra: annotated vs tagged → Signatures 差異', async () => {
    const result = await compareStructure(FIXTURES.annotated, FIXTURES.tagged);
    const sigDiff = result.diffs.find((d) => d.property === 'Has Signatures');
    expect(sigDiff).toBeDefined();
    expect(sigDiff?.file1Value).toBe('true');
    expect(sigDiff?.file2Value).toBe('false');
  });
});
