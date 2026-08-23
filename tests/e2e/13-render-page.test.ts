/**
 * 13 - render_page (#23)
 *
 * RP-1〜RP-7. The suite decodes what the renderer produces (through pdf-lib +
 * pdfjs, the same round-trip as IM-9) rather than trusting headers: the
 * napi-canvas attempt this replaced produced structurally valid, entirely
 * blank pages — a header check would have called that success.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDER_DPI,
  rendererAvailable,
  renderPages,
} from '../../src/services/page-renderer.js';
import { FIXTURES } from './setup.js';

const available = await rendererAvailable();

describe.skipIf(!available)('13 - render_page', () => {
  // RP-1: 画像しか無いページ（no_text_layer）が描画できる — このツールの存在理由
  it('RP-1: an image-only page renders, with ink on it', async () => {
    const result = await renderPages(FIXTURES.noTextLayer, '1');
    expect(result.pages).toHaveLength(1);
    const page = result.pages[0];
    expect(page.mimeType).toBe('image/png');

    const ink = await countInk(page.dataBase64);
    // The fixture draws a checkerboard across 515×300 pt of the page.
    expect(ink).toBeGreaterThan(1000);
  });

  // RP-2: テキストのページも白紙にならない（フォントデータ欠落の回帰）
  //
  // napi-canvas 経路は standardFontDataUrl 無しで全グリフを黙って落とし、
  // 「成功した白紙」を返した。ここはピクセルで表明する。
  it('RP-2: a text page renders glyphs, not a blank page', async () => {
    const result = await renderPages(FIXTURES.simple, '1');
    const ink = await countInk(result.pages[0].dataBase64);
    expect(ink).toBeGreaterThan(500);
  });

  // RP-3: 既定 150dpi の寸法 = 595pt × 150/72
  it('RP-3: default dpi produces the expected pixel size', async () => {
    const result = await renderPages(FIXTURES.simple, '1');
    const page = result.pages[0];
    expect(page.pointWidth).toBe(595);
    const expected = Math.floor((595 * DEFAULT_RENDER_DPI) / 72);
    expect(Math.abs(page.width - expected)).toBeLessThanOrEqual(2);
    expect(page.effectiveDpi).toBeGreaterThanOrEqual(DEFAULT_RENDER_DPI - 2);
    expect(page.effectiveDpi).toBeLessThanOrEqual(DEFAULT_RENDER_DPI + 2);
  });

  // RP-4: max_width は dpi に勝つ
  it('RP-4: max_width caps the render below what dpi asks for', async () => {
    const result = await renderPages(FIXTURES.simple, '1', { dpi: 300, maxWidth: 400 });
    expect(result.pages[0].width).toBeLessThanOrEqual(400);
  });

  // RP-5: jpeg 指定で本物の JPEG が返る
  it('RP-5: format jpeg produces a real JPEG', async () => {
    const result = await renderPages(FIXTURES.simple, '1', { format: 'jpeg', quality: 85 });
    const bytes = Buffer.from(result.pages[0].dataBase64, 'base64');
    expect(result.pages[0].mimeType).toBe('image/jpeg');
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(bytes.subarray(bytes.length - 2).toString('hex')).toBe('ffd9');
  });

  // RP-6: 予算超過は理由付きで申告される（黙って落とさない）
  it('RP-6: a page over the byte budget is named, not dropped', async () => {
    const result = await renderPages(FIXTURES.simple, '1-2', { maxTotalBytes: 10 });
    expect(result.pages).toHaveLength(0);
    expect(result.omitted).toHaveLength(2);
    for (const omitted of result.omitted) expect(omitted.reason).toContain('budget');
  });

  // RP-7: 複数ページの範囲指定
  it('RP-7: a range renders each page once, in order', async () => {
    const result = await renderPages(FIXTURES.simple, '1-3');
    expect(result.pages.map((p) => p.page)).toEqual([1, 2, 3]);
  });
});

describe.skipIf(available)('13 - render_page (renderer absent)', () => {
  it('RP-abs: the absence is reported as a message, not a crash', async () => {
    await expect(renderPages(FIXTURES.simple, '1')).rejects.toThrow('@hyzyla/pdfium');
  });
});

/** Count dark pixels in a PNG/JPEG by decoding it through pdf-lib + pdfjs. */
async function countInk(dataBase64: string): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const bytes = new Uint8Array(Buffer.from(dataBase64, 'base64'));
  const doc = await PDFDocument.create();
  const isPng = bytes[0] === 0x89;
  const image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

  const parsed = await getDocument({ data: await doc.save(), verbosity: 0 }).promise;
  const first = await parsed.getPage(1);
  const ops = await first.getOperatorList();
  let name: string | null = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] === OPS.paintImageXObject) name = ops.argsArray[i][0] as string;
  }
  if (!name) throw new Error('no image in round-trip PDF');
  const pool = name.startsWith('g_') ? first.commonObjs : first.objs;
  const decoded = await new Promise<{ data: Uint8Array; kind: number }>((resolve) =>
    pool.get(name as string, resolve as never),
  );
  const stride = decoded.kind === 3 ? 4 : decoded.kind === 2 ? 3 : 1;
  let ink = 0;
  for (let i = 0; i < decoded.data.length; i += stride) if (decoded.data[i] < 128) ink++;
  await parsed.destroy();
  return ink;
}
