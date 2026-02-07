/**
 * 09 - Performance Baseline E2E Tests
 *
 * PF-1〜PF-9: 各サービスのパフォーマンス計測 & 回帰チェック
 */
import { afterAll, describe, it } from 'vitest';
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
import { PERF_THRESHOLDS, SEARCH_QUERIES } from './constants.js';
import { measureAndCheck, saveBaseline } from './helpers.js';
import { FIXTURES } from './setup.js';

describe('09 - Performance Baseline', () => {
  afterAll(() => {
    saveBaseline();
  });

  // PF-1: getMetadata (コールド)
  it('PF-1: getMetadata completes within threshold', async () => {
    await measureAndCheck(
      'getMetadata',
      () => getMetadata(FIXTURES.simple),
      PERF_THRESHOLDS.getMetadata,
    );
  });

  // PF-2: extractText 3ページ
  it('PF-2: extractText (3 pages) completes within threshold', async () => {
    await measureAndCheck(
      'extractText-3pages',
      () => extractText(FIXTURES.simple),
      PERF_THRESHOLDS.extractText3Pages,
    );
  });

  // PF-3: searchText
  it('PF-3: searchText completes within threshold', async () => {
    await measureAndCheck(
      'searchText',
      () => searchText(FIXTURES.simple, SEARCH_QUERIES.pdf),
      PERF_THRESHOLDS.searchText,
    );
  });

  // PF-4: analyzeStructure
  it('PF-4: analyzeStructure completes within threshold', async () => {
    await measureAndCheck(
      'analyzeStructure',
      () => analyzeStructure(FIXTURES.simple),
      PERF_THRESHOLDS.analyzeStructure,
    );
  });

  // PF-5: analyzeFontsWithPdfLib
  it('PF-5: analyzeFonts completes within threshold', async () => {
    await measureAndCheck(
      'analyzeFonts',
      () => analyzeFontsWithPdfLib(FIXTURES.multiFont),
      PERF_THRESHOLDS.analyzeFonts,
    );
  });

  // PF-6: validateTagged
  it('PF-6: validateTagged completes within threshold', async () => {
    await measureAndCheck(
      'validateTagged',
      () => validateTagged(FIXTURES.tagged),
      PERF_THRESHOLDS.validateTagged,
    );
  });

  // PF-7: validateMetadata
  it('PF-7: validateMetadata completes within threshold', async () => {
    await measureAndCheck(
      'validateMetadata',
      () => validateMetadata(FIXTURES.simple),
      PERF_THRESHOLDS.validateMetadata,
    );
  });

  // PF-8: compareStructure
  it('PF-8: compareStructure completes within threshold', async () => {
    await measureAndCheck(
      'compareStructure',
      () => compareStructure(FIXTURES.simple, FIXTURES.annotated),
      PERF_THRESHOLDS.compareStructure,
    );
  });

  // PF-9: 全フィクスチャの getMetadata 合計
  it('PF-9: getMetadata for all fixtures within threshold', async () => {
    const fixtures = [
      FIXTURES.simple,
      FIXTURES.empty,
      FIXTURES.annotated,
      FIXTURES.comprehensive,
      FIXTURES.tagged,
      FIXTURES.multiFont,
      FIXTURES.noMetadata,
    ];
    await measureAndCheck(
      'getMetadata-all-7',
      async () => {
        for (const f of fixtures) {
          await getMetadata(f);
        }
      },
      PERF_THRESHOLDS.allFixturesMetadata,
    );
  });

  // PF-extra: countImages
  it('PF-extra: countImages completes within threshold', async () => {
    await measureAndCheck(
      'countImages',
      () => countImages(FIXTURES.comprehensive),
      PERF_THRESHOLDS.countImages,
    );
  });

  // PF-extra: analyzeSignatures
  it('PF-extra: analyzeSignatures completes within threshold', async () => {
    await measureAndCheck(
      'analyzeSignatures',
      () => analyzeSignatures(FIXTURES.annotated),
      PERF_THRESHOLDS.analyzeSignatures,
    );
  });
});
