/**
 * 09 - Performance Baseline E2E Tests
 *
 * PF-1〜PF-9: 各サービスのパフォーマンス計測 & 回帰チェック
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  countImages,
  extractText,
  getMetadata,
  searchText,
} from '../../src/services/pdfjs-service.js';
import {
  analyzeFontsWithPdfLib,
  analyzeSignatures,
  analyzeStructure,
} from '../../src/services/pdflib-service.js';
import {
  compareStructure,
  validateMetadata,
  validateTagged,
} from '../../src/services/validation-service.js';
import { checkRegression, recordPerformance, saveBaseline, withTiming } from './helpers.js';
import { FIXTURES } from './setup.js';

describe('09 - Performance Baseline', () => {
  afterAll(() => {
    // ベースラインを保存
    saveBaseline();
  });

  // PF-1: getMetadata (コールド)
  it('PF-1: getMetadata < 2000ms', async () => {
    const { durationMs } = await withTiming(() => getMetadata(FIXTURES.simple));
    recordPerformance('getMetadata', durationMs);

    const regression = checkRegression('getMetadata', durationMs);
    if (regression.regressed) {
      console.warn(
        `⚠️ getMetadata 性能劣化: ${regression.baselineMs}ms → ${durationMs}ms (${regression.changePercent}%)`,
      );
    }
    expect(durationMs).toBeLessThan(2000);
  });

  // PF-2: extractText 3ページ
  it('PF-2: extractText (3ページ) < 3000ms', async () => {
    const { durationMs } = await withTiming(() => extractText(FIXTURES.simple));
    recordPerformance('extractText-3pages', durationMs);

    const regression = checkRegression('extractText-3pages', durationMs);
    if (regression.regressed) {
      console.warn(
        `⚠️ extractText 性能劣化: ${regression.baselineMs}ms → ${durationMs}ms (${regression.changePercent}%)`,
      );
    }
    expect(durationMs).toBeLessThan(3000);
  });

  // PF-3: searchText
  it('PF-3: searchText < 2000ms', async () => {
    const { durationMs } = await withTiming(() => searchText(FIXTURES.simple, 'PDF'));
    recordPerformance('searchText', durationMs);
    expect(durationMs).toBeLessThan(2000);
  });

  // PF-4: analyzeStructure
  it('PF-4: analyzeStructure < 2000ms', async () => {
    const { durationMs } = await withTiming(() => analyzeStructure(FIXTURES.simple));
    recordPerformance('analyzeStructure', durationMs);
    expect(durationMs).toBeLessThan(2000);
  });

  // PF-5: analyzeFontsWithPdfLib
  it('PF-5: analyzeFontsWithPdfLib < 3000ms', async () => {
    const { durationMs } = await withTiming(() => analyzeFontsWithPdfLib(FIXTURES.multiFont));
    recordPerformance('analyzeFonts', durationMs);
    expect(durationMs).toBeLessThan(3000);
  });

  // PF-6: validateTagged
  it('PF-6: validateTagged < 5000ms', async () => {
    const { durationMs } = await withTiming(() => validateTagged(FIXTURES.tagged));
    recordPerformance('validateTagged', durationMs);
    expect(durationMs).toBeLessThan(5000);
  });

  // PF-7: validateMetadata
  it('PF-7: validateMetadata < 3000ms', async () => {
    const { durationMs } = await withTiming(() => validateMetadata(FIXTURES.simple));
    recordPerformance('validateMetadata', durationMs);
    expect(durationMs).toBeLessThan(3000);
  });

  // PF-8: compareStructure
  it('PF-8: compareStructure < 5000ms', async () => {
    const { durationMs } = await withTiming(() =>
      compareStructure(FIXTURES.simple, FIXTURES.annotated),
    );
    recordPerformance('compareStructure', durationMs);
    expect(durationMs).toBeLessThan(5000);
  });

  // PF-9: 全フィクスチャの getMetadata 合計
  it('PF-9: 全フィクスチャの getMetadata 合計 < 15000ms', async () => {
    const fixtures = [
      FIXTURES.simple,
      FIXTURES.empty,
      FIXTURES.annotated,
      FIXTURES.comprehensive,
      FIXTURES.tagged,
      FIXTURES.multiFont,
      FIXTURES.noMetadata,
    ];
    const { durationMs } = await withTiming(async () => {
      for (const f of fixtures) {
        await getMetadata(f);
      }
    });
    recordPerformance('getMetadata-all-7', durationMs);
    expect(durationMs).toBeLessThan(15000);
  });

  // PF-extra: countImages
  it('PF-extra: countImages < 2000ms', async () => {
    const { durationMs } = await withTiming(() => countImages(FIXTURES.comprehensive));
    recordPerformance('countImages', durationMs);
    expect(durationMs).toBeLessThan(2000);
  });

  // PF-extra: analyzeSignatures
  it('PF-extra: analyzeSignatures < 2000ms', async () => {
    const { durationMs } = await withTiming(() => analyzeSignatures(FIXTURES.annotated));
    recordPerformance('analyzeSignatures', durationMs);
    expect(durationMs).toBeLessThan(2000);
  });
});
