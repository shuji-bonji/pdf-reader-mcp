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

  // IM-7: 返ってくるのは生ピクセルではなく画像ファイルである（#22 の回帰）
  //
  // 旧実装は `imgData.data`（デコード済みピクセル）をそのまま base64 にしていた。
  // 8×8 RGB なら 192 バイトで、PNG/JPEG のシグネチャはどこにも無い。
  // 「画像を返している」ように見えて、どのビューアも視覚モデルも開けなかった。
  it('IM-7: what comes back is an image FILE, not raw pixels', async () => {
    const result = await extractImages(FIXTURES.imageKinds);

    for (const img of result.images) {
      const bytes = Buffer.from(img.dataBase64, 'base64');
      expect(img.mimeType).toBe('image/png');
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(bytes.length).toBe(img.encodedBytes);

      // IHDR は先頭チャンク。宣言された寸法が報告した寸法と一致すること。
      expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
      expect(bytes.readUInt32BE(16)).toBe(img.width);
      expect(bytes.readUInt32BE(20)).toBe(img.height);
    }
  });

  // IM-9: PNG は往復して 1 バイトも変わらない（可逆であることの表明）
  //
  // 画素まで比べる: 寸法だけ見ていると、色が入れ替わっていても通ってしまう。
  it('IM-9: the PNG round-trips through pdf.js with identical pixels', async () => {
    const result = await extractImages(FIXTURES.imageKinds);
    const rgb = result.images.find((i) => i.colorSpace === 'RGB');
    expect(rgb).toBeDefined();
    if (!rgb) return;

    const back = await decodeThroughPdfjs(Buffer.from(rgb.dataBase64, 'base64'), 'png');
    expect(back.width).toBe(rgb.width);
    expect(back.height).toBe(rgb.height);

    const source = await rawPixels(FIXTURES.imageKinds, rgb.page, rgb.index);
    let maxDiff = 0;
    for (let i = 0; i < rgb.width * rgb.height; i++) {
      for (let c = 0; c < 3; c++) {
        const got = back.data[i * (back.channels === 4 ? 4 : 3) + c];
        maxDiff = Math.max(maxDiff, Math.abs(got - source[i * 3 + c]));
      }
    }
    expect(maxDiff).toBe(0);
  });

  // IM-10: JPEG も本物のファイルで、画素は許容差の内側に収まる
  it('IM-10: format "jpeg" produces a decodable JPEG close to the source', async () => {
    const result = await extractImages(FIXTURES.imageKinds, undefined, {
      format: 'jpeg',
      quality: 90,
    });
    const rgb = result.images.find((i) => i.colorSpace === 'RGB');
    expect(rgb).toBeDefined();
    if (!rgb) return;

    const bytes = Buffer.from(rgb.dataBase64, 'base64');
    expect(rgb.mimeType).toBe('image/jpeg');
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(bytes.subarray(bytes.length - 2).toString('hex')).toBe('ffd9');

    const back = await decodeThroughPdfjs(bytes, 'jpg');
    const source = await rawPixels(FIXTURES.imageKinds, rgb.page, rgb.index);
    let sum = 0;
    for (let i = 0; i < rgb.width * rgb.height; i++) {
      for (let c = 0; c < 3; c++) {
        const got = back.data[i * (back.channels === 4 ? 4 : 3) + c];
        sum += Math.abs(got - source[i * 3 + c]);
      }
    }
    // 可逆ではないので厳密一致は求めない。ただし「別の絵」になっていないこと。
    expect(sum / (rgb.width * rgb.height * 3)).toBeLessThan(6);
  });

  // IM-11: 1bpp グレースケールも開ける PNG になる（拡張の取り違えを捕まえる）
  it('IM-11: 1bpp grayscale is encoded as an 8-bit greyscale PNG', async () => {
    const result = await extractImages(FIXTURES.imageKinds);
    const gray = result.images.find((i) => i.colorSpace === 'Grayscale');
    expect(gray).toBeDefined();
    if (!gray) return;

    const bytes = Buffer.from(gray.dataBase64, 'base64');
    expect(bytes[24]).toBe(8); // IHDR bit depth
    expect(bytes[25]).toBe(0); // IHDR colour type 0 = greyscale
    // 申告は元のビット深度のまま。エンコード形式とファイル中の形式は別の事実。
    expect(gray.bitsPerComponent).toBe(1);
  });

  // IM-12: max_width は面積平均で縮小し、縮小したことを申告する
  it('IM-12: max_width downscales and says so', async () => {
    const result = await extractImages(FIXTURES.imageKinds, undefined, { maxWidth: 4 });
    expect(result.extractedCount).toBe(3);

    for (const img of result.images) {
      expect(img.width).toBeLessThanOrEqual(4);
      expect(img.downscaled).toBe(true);
      expect(img.sourceWidth).toBe(8);
    }
  });

  // IM-13: 拡大はしない
  it('IM-13: a smaller image is not enlarged', async () => {
    const result = await extractImages(FIXTURES.imageKinds, undefined, { maxWidth: 4096 });
    for (const img of result.images) {
      expect(img.width).toBe(img.sourceWidth);
      expect(img.downscaled).toBe(false);
    }
  });

  // IM-14: 予算を超えた画像は黙って消えず、理由付きで名指しされる
  it('IM-14: an image over the byte budget is reported, not dropped silently', async () => {
    const result = await extractImages(FIXTURES.imageKinds, undefined, { maxTotalBytes: 1 });
    expect(result.extractedCount).toBe(0);
    expect(result.omitted.length).toBe(3);
    for (const omitted of result.omitted) {
      expect(omitted.reason).toContain('budget');
    }
    // 検出できた枚数は変わらない。返さなかったこととデコードできなかったことは別。
    expect(result.detectedCount).toBe(3);
    expect(result.skippedCount).toBe(0);
  });

  // IM-4: countImages の整合性
  it('IM-4: countImages matches extractImages.detectedCount', async () => {
    const count = await countImages(FIXTURES.comprehensive);
    const result = await extractImages(FIXTURES.comprehensive);
    expect(count).toBe(result.detectedCount);
  });

  // IM-extra: 検出した画像の行き先が全て説明されている
  //
  // #22 以降 detected は「返した」「デコードできなかった」「予算等で返さなかった」の
  // 3 つに分かれる。差し引き 1 本の等式では、返さなかった分がデコード失敗に
  // 化けて見えなくなる。
  it('IM-extra: every detected image is accounted for', async () => {
    const result = await extractImages(FIXTURES.comprehensive);
    expect(result.extractedCount + result.skippedCount + result.omitted.length).toBe(
      result.detectedCount,
    );
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

// ─── helpers ────────────────────────────────────────────
//
// The encoders are verified by decoding what they produce with a decoder this
// project already ships (pdfjs, through a one-page PDF built with pdf-lib).
// Checking only the header would pass for a file whose pixels are wrong.

async function decodeThroughPdfjs(
  bytes: Buffer,
  kind: 'png' | 'jpg',
): Promise<{ width: number; height: number; channels: number; data: Uint8Array }> {
  const { PDFDocument } = await import('pdf-lib');
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const doc = await PDFDocument.create();
  // A fresh copy: a Buffer from Buffer.concat can be a view into a pooled
  // ArrayBuffer, and pdf-lib's embedders read through `.buffer`.
  const copy = new Uint8Array(bytes);
  const image = kind === 'png' ? await doc.embedPng(copy) : await doc.embedJpg(copy);
  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

  const pdf = await doc.save();
  const parsed = await getDocument({ data: pdf, verbosity: 0 }).promise;
  const first = await parsed.getPage(1);
  const ops = await first.getOperatorList();
  let name: string | null = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] === OPS.paintImageXObject) name = ops.argsArray[i][0] as string;
  }
  if (!name) throw new Error('no image operator in the round-trip PDF');
  const pool = name.startsWith('g_') ? first.commonObjs : first.objs;
  const decoded = await new Promise<{
    width: number;
    height: number;
    kind: number;
    data: Uint8Array;
  }>((resolve) => pool.get(name as string, resolve as never));
  await parsed.destroy();

  return {
    width: decoded.width,
    height: decoded.height,
    channels: decoded.kind === 3 ? 4 : decoded.kind === 2 ? 3 : 1,
    data: decoded.data,
  };
}

/** The pixels pdfjs decoded for one image of a fixture, before this server touched them. */
async function rawPixels(filePath: string, pageNumber: number, index: number): Promise<Uint8Array> {
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { readFile } = await import('node:fs/promises');

  const doc = await getDocument({ data: new Uint8Array(await readFile(filePath)), verbosity: 0 })
    .promise;
  const page = await doc.getPage(pageNumber);
  const ops = await page.getOperatorList();
  let seen = -1;
  let name: string | null = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] === OPS.paintImageXObject) {
      seen++;
      if (seen === index) name = ops.argsArray[i][0] as string;
    }
  }
  if (!name) throw new Error(`image ${index} not found on page ${pageNumber}`);
  const pool = name.startsWith('g_') ? page.commonObjs : page.objs;
  const decoded = await new Promise<{ data: Uint8Array }>((resolve) =>
    pool.get(name as string, resolve as never),
  );
  await doc.destroy();
  return decoded.data;
}
