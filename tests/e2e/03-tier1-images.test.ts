/**
 * 03 - Tier 1 Image Extraction E2E Tests
 *
 * IM-1〜IM-4: read_images (extractImages / countImages)
 */
import { describe, expect, it } from 'vitest';
import { countImages, extractImages } from '../../src/services/pdfjs-service.js';
import { FIXTURES } from './setup.js';

describe('03 - read_images', () => {
  // IM-1: comprehensive_1.pdf (画像あり)
  it('IM-1: comprehensive_1.pdf で detectedCount > 0', async () => {
    const result = await extractImages(FIXTURES.comprehensive);
    expect(result.detectedCount).toBeGreaterThan(0);
  });

  // IM-2: simple.pdf (画像なし)
  it('IM-2: simple.pdf で detectedCount = 0', async () => {
    const result = await extractImages(FIXTURES.simple);
    expect(result.detectedCount).toBe(0);
    expect(result.extractedCount).toBe(0);
    expect(result.images).toHaveLength(0);
  });

  // IM-3: 抽出画像のプロパティ
  it('IM-3: 抽出画像のプロパティが正確', async () => {
    const result = await extractImages(FIXTURES.comprehensive);
    if (result.extractedCount > 0) {
      const img = result.images[0];
      expect(img.page).toBeGreaterThanOrEqual(1);
      expect(img.index).toBeGreaterThanOrEqual(0);
      expect(img.width).toBeGreaterThan(0);
      expect(img.height).toBeGreaterThan(0);
      expect(typeof img.colorSpace).toBe('string');
      expect(['RGB', 'RGBA', 'Grayscale']).toContain(img.colorSpace);
      expect(img.bitsPerComponent).toBe(8);
      expect(img.dataBase64.length).toBeGreaterThan(0);
    }
  });

  // IM-4: countImages の整合性
  it('IM-4: countImages と extractImages の detected が一致', async () => {
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
  it('IM-extra: empty.pdf で画像なし', async () => {
    const count = await countImages(FIXTURES.empty);
    expect(count).toBe(0);
  });

  // IM-extra: 全テキストPDFに画像なし
  it('IM-extra: テキストのみPDFに画像なし', async () => {
    const count = await countImages(FIXTURES.multiFont);
    expect(count).toBe(0);
  });
});
