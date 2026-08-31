/**
 * 16 - 描画が終わらないページに時限を置く（#27）
 *
 * PDFium は WASM の中で**同期に**走る。0.13.0 まで `render_page` は同じスレッドで
 * それを呼んでおり、終わらない文書を 1 つ渡すとサーバが応答を返さなくなった
 * （veraPDF コーパスの 3.4 KB のファイル 2 件で実測。20 分待っても返らない）。
 * JavaScript 側の時限では割り込めない —— 1 秒ごとのタイマーの印が 1 つも出ない。
 *
 * ここで固定するのは 3 つ。
 *   1. 止まっても呼び出しは返る
 *   2. **止まる前に描けたページは返す**
 *   3. 描けなかったページと、始めなかったページを、別の理由として申告する
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderPages } from '../../src/services/page-renderer.js';
import { RENDER_STALL_SPECIMEN } from './render-stall-specimen.js';
import { FIXTURES } from './setup.js';

/** 止まる検体を毎回この時間だけ回す検査なので、短めに置く。 */
const TIMEOUT_MS = 3000;

let stallPath = '';

beforeAll(() => {
  const bytes = Buffer.from(RENDER_STALL_SPECIMEN.base64, 'base64');
  expect(createHash('sha256').update(bytes).digest('hex').slice(0, 32)).toBe(
    RENDER_STALL_SPECIMEN.sha256,
  );
  stallPath = join(mkdtempSync(join(tmpdir(), 'render-stall-')), RENDER_STALL_SPECIMEN.name);
  writeFileSync(stallPath, bytes);
});

describe('16 - render timeout', () => {
  it('RT-1: 止まる前に描けたページは返す', async () => {
    const result = await renderPages(stallPath, '1-3', {
      dpi: 36,
      format: 'png',
      pageTimeoutMs: TIMEOUT_MS,
    });
    // 🔴 1 ページ目は描けている。全部捨てると、描けたものまで無かったことになる。
    expect(result.pages.map((p) => p.page)).toEqual([1]);
    expect(result.pages[0].encodedBytes).toBeGreaterThan(0);
    expect(result.totalEncodedBytes).toBe(result.pages[0].encodedBytes);
  }, 30_000);

  it('RT-2: 描けなかったページと、始めなかったページを別の理由で申告する', async () => {
    const result = await renderPages(stallPath, '1-3', {
      dpi: 36,
      format: 'png',
      pageTimeoutMs: TIMEOUT_MS,
    });
    const byPage = new Map(result.omitted.map((o) => [o.page, o.reason]));
    expect([...byPage.keys()].sort()).toEqual([2, 3]);
    expect(byPage.get(2)).toContain(`did not finish within ${TIMEOUT_MS} ms`);
    // 3 ページ目は描けないのではなく、順番が来なかった。同じ理由にしない。
    expect(byPage.get(3)).toContain('not attempted');
    expect(byPage.get(3)).not.toContain('did not finish');
  }, 30_000);

  it('RT-3: 描いている間もこのスレッドは動いている', async () => {
    let ticks = 0;
    const interval = setInterval(() => {
      ticks++;
    }, 200);
    try {
      await renderPages(stallPath, '2', { dpi: 36, format: 'png', pageTimeoutMs: TIMEOUT_MS });
    } finally {
      clearInterval(interval);
    }
    // 🔴 0.13.0 ではここが 0 になる（イベントループごと止まっていた）。
    expect(ticks).toBeGreaterThan(3);
  }, 30_000);

  it('RT-4: 普通の文書はこれまでどおり描ける', async () => {
    const result = await renderPages(FIXTURES.tagged, '1-2', { dpi: 36, format: 'png' });
    expect(result.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(result.omitted).toEqual([]);
    expect(result.pages[0].mimeType).toBe('image/png');
  }, 30_000);
});
