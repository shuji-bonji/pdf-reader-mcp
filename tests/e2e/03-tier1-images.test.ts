/**
 * 03 - Tier 1 Image Extraction E2E Tests
 *
 * IM-1〜IM-4: read_images (extractImages / countImages)
 */
import { describe, expect, it } from 'vitest';
import { countImages, extractImages } from '../../src/services/pdfjs-service.js';
import { IMAGE_BITS_PER_COMPONENT, VALID_COLOR_SPACES } from './constants.js';
import { FIXTURES } from './setup.js';

describe('03 - read_images', () => {
  // IM-1: comprehensive_1.pdf (画像あり)
  it('IM-1: comprehensive_1.pdf detects images', async () => {
    const result = await extractImages(FIXTURES.comprehensive);
    expect(result.detectedCount).toBeGreaterThan(0);
  });

  // IM-2: simple.pdf (画像なし)
  it('IM-2: simple.pdf has no images', async () => {
    const result = await extractImages(FIXTURES.simple);
    expect(result.detectedCount).toBe(0);
    expect(result.extractedCount).toBe(0);
    expect(result.images).toHaveLength(0);
  });

  // IM-3: 抽出画像のプロパティ
  it('IM-3: extracted image properties are valid', async () => {
    const result = await extractImages(FIXTURES.comprehensive);
    if (result.extractedCount > 0) {
      const img = result.images[0];
      expect(img.page).toBeGreaterThanOrEqual(1);
      expect(img.index).toBeGreaterThanOrEqual(0);
      expect(img.width).toBeGreaterThan(0);
      expect(img.height).toBeGreaterThan(0);
      expect(typeof img.colorSpace).toBe('string');
      expect(VALID_COLOR_SPACES).toContain(img.colorSpace);
      expect(img.bitsPerComponent).toBe(IMAGE_BITS_PER_COMPONENT);
      expect(img.dataBase64.length).toBeGreaterThan(0);
    }
  });

  // IM-4: countImages の整合性
  it('IM-4: countImages matches extractImages.detectedCount', async () => {
    const count = await countImages(FIXTURES.comprehensive);
    const result = await extractImages(FIXTURES.comprehensive);
    expect(count).toBe(result.detectedCount);
  });

  // IM-extra: skippedCount の計算
  it('IM-extra: skippedCount = detectedCount - extractedCount', async () => {
    const result = await extractImages(FIXTURES.comprehensive);
    expect(result.skippedCount).toBe(result.detectedCount - result.extractedCount);
  });

  // IM-extra: empty.pdf に画像なし
  it('IM-extra: empty.pdf has no images', async () => {
    const count = await countImages(FIXTURES.empty);
    expect(count).toBe(0);
  });

  // IM-extra: テキストのみPDFに画像なし
  it('IM-extra: text-only PDF has no images', async () => {
    const count = await countImages(FIXTURES.multiFont);
    expect(count).toBe(0);
  });
});
