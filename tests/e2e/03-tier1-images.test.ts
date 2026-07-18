/**
 * 03 - Tier 1 Image Extraction E2E Tests
 *
 * IM-1〜IM-4: read_images (extractImages / countImages)
 */
import { describe, expect, it } from 'vitest';
import { countImages, extractImages } from '../../src/services/pdfjs-service.js';
import { VALID_BITS_PER_COMPONENT, VALID_COLOR_SPACES } from './constants.js';
import { FIXTURES } from './setup.js';

describe('03 - read_images', () => {
  // IM-1: comprehensive_1.pdf (画像あり)
  //
  // detectedCount はオペレータ走査だけで数えられるため、**抽出が全く動かなくても
  // 通ってしまう**。実際 D-9 の間ずっと緑だった。抽出できることは IM-8 で表明する。
  it('IM-1: comprehensive_1.pdf detects images', async () => {
    const result = await extractImages(FIXTURES.comprehensive);
    expect(result.detectedCount).toBeGreaterThan(0);
  });

  // IM-8: ページ間で共有された画像（pdfjs の `g_` 接頭辞 = commonObjs 側）も抽出する
  //
  // comprehensive_1.pdf は同じ画像を 1 ページ目と 3 ページ目に描くので、pdfjs は
  // 後者をグローバルオブジェクト `g_d0_img_p2_1` として commonObjs に置く。
  // `page.objs` だけを見ていると**永久に解決せず**、タイムアウトまで待って取りこぼす。
  // （D-9 の初回修正がこれで、IM-1/IM-4 が 1 件あたり 10 秒かかっていた。
  //   pdfjs 自身の getObject と同じく `g_` 接頭辞で分岐して解消）
  it('IM-8: images shared across pages (commonObjs) are extracted', async () => {
    const result = await extractImages(FIXTURES.comprehensive);

    expect(result.detectedCount).toBe(2);
    expect(result.extractedCount).toBe(2);
    // commonObjs を見ていないと g_ 側が skipped に落ちる
    expect(result.skippedCount).toBe(0);
  });

  // IM-2: simple.pdf (画像なし)
  it('IM-2: simple.pdf has no images', async () => {
    const result = await extractImages(FIXTURES.simple);
    expect(result.detectedCount).toBe(0);
    expect(result.extractedCount).toBe(0);
    expect(result.images).toHaveLength(0);
  });

  // IM-3: 抽出画像のプロパティ
  //
  // かつてこの本体は `if (result.extractedCount > 0)` で囲まれていた。D-9 により
  // 抽出は常に 0 件だったので、**本体は一度も実行されず空振りで緑**だった。
  // それが High-2（ImageKind 誤マッピング）と D-9 の両方を隠していたので、
  // ガードを外し、抽出できることを先に表明する。
  it('IM-3: extracted image properties are valid', async () => {
    const result = await extractImages(FIXTURES.imageKinds);

    expect(result.extractedCount).toBeGreaterThan(0);
    for (const img of result.images) {
      expect(img.page).toBeGreaterThanOrEqual(1);
      expect(img.index).toBeGreaterThanOrEqual(0);
      expect(img.width).toBeGreaterThan(0);
      expect(img.height).toBeGreaterThan(0);
      expect(VALID_COLOR_SPACES).toContain(img.colorSpace);
      expect(VALID_BITS_PER_COMPONENT).toContain(img.bitsPerComponent);
      expect(img.dataBase64.length).toBeGreaterThan(0);
    }
  });

  // ========================================
  // D-9 regression: read_images が 1 枚も抽出できなかった問題
  //
  // 原因は pdfjs の `objs.get(name)`（同期形式）が
  // "Requesting object that isn't resolved yet" を投げること。画像データは
  // worker から非同期に届くため、getOperatorList() の完了とは別。
  // catch がそれを飲み込み「encoding format のせい」と誤って報告していた。
  // ========================================

  // IM-5: 検出した画像は全て抽出できる（skipped が出ない）
  it('IM-5: all detected images are actually extracted', async () => {
    const result = await extractImages(FIXTURES.imageKinds);

    expect(result.detectedCount).toBe(3);
    expect(result.extractedCount).toBe(3);
    expect(result.skippedCount).toBe(0);
  });

  // IM-6: High-2 の回帰 — ImageKind ごとの colorSpace / bitsPerComponent
  //       pdfjs 実物で kind=1 GRAYSCALE_1BPP / 2 RGB_24BPP / 3 RGBA_32BPP を確認済み
  it('IM-6: each ImageKind maps to the right colorSpace and bitsPerComponent', async () => {
    const result = await extractImages(FIXTURES.imageKinds);
    const spaces = result.images.map((i) => i.colorSpace).sort();

    expect(spaces).toEqual(['Grayscale', 'RGB', 'RGBA']);

    const gray = result.images.find((i) => i.colorSpace === 'Grayscale');
    const rgbImg = result.images.find((i) => i.colorSpace === 'RGB');
    const rgba = result.images.find((i) => i.colorSpace === 'RGBA');

    // 1bpp。旧実装の `bitsPerComponent: 8` 固定はここで嘘になっていた
    expect(gray?.bitsPerComponent).toBe(1);
    expect(rgbImg?.bitsPerComponent).toBe(8);
    expect(rgba?.bitsPerComponent).toBe(8);
  });

  // IM-7: デコード後バッファのサイズが申告した色空間/ビット深度と整合する
  //       （colorSpace だけ直して bitsPerComponent を放置する類の退行を捕まえる）
  it('IM-7: decoded buffer size agrees with the reported format', async () => {
    const result = await extractImages(FIXTURES.imageKinds);

    const bytesPerPixel: Record<string, number> = { RGB: 3, RGBA: 4 };
    for (const img of result.images) {
      const bytes = Buffer.from(img.dataBase64, 'base64').length;
      // 1bpp は行ごとにバイト境界へ切り上げる（8px = 1 byte）
      const expected =
        img.colorSpace === 'Grayscale'
          ? Math.ceil((img.width * img.bitsPerComponent) / 8) * img.height
          : img.width * img.height * bytesPerPixel[img.colorSpace];
      expect(bytes).toBe(expected);
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
