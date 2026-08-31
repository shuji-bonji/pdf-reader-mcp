/**
 * Page rasterisation for `render_page` (#23), through PDFium compiled to
 * WebAssembly (`@hyzyla/pdfium`).
 *
 * Why not pdf.js + a Canvas implementation: measured on this repository's own
 * fixtures (2026-08-23, Linux x64, Node 22, @napi-rs/canvas 1.0.7 and 0.1.80),
 * `page.render()` segfaults the process on any page that draws an image — and
 * an MCP server is a process, so the whole server dies, on exactly the pages
 * this tool exists for. Text-only pages rendered, but only with
 * `standardFontDataUrl` configured; without it every glyph was skipped and the
 * output was a blank page that *looked* like a successful render.
 *
 * Why the dependency is acceptable when a native addon was not (#21, #22): the
 * package is a single WASM binary with zero dependencies and no `os`/`cpu`
 * restriction — every platform installs the same bytes, so the published
 * package behaves the same everywhere `npx` runs it. It sits in
 * `optionalDependencies`: when absent, `render_page` reports that and what to
 * install, rather than failing to start the server.
 *
 * PDFium is a different engine from the pdfjs this server reads text with. That
 * is stated in the tool description rather than hidden: a rendering difference
 * between the two is possible, and pretending one engine produced both outputs
 * would misattribute any such difference.
 *
 * 🔴 描画そのものは Worker で走る（#27）。PDFium は WASM の中で同期に走るので、
 * 終わらない文書があるとイベントループごと止まり、サーバは応答を返さなくなる。
 * JavaScript 側の時限では割り込めない（タイマーの印が 1 つも出ないことを実測）。
 * `worker.terminate()` は止まった PDFium を実際に止められるので、そこに移した。
 * 詳細と実例は `page-renderer.worker.mjs` の冒頭にある。
 *
 * 🔴 **Worker が作るのは画素までで、符号化はこちら側で行う。** worker は
 * `src` の module を 1 つも import できない —— TypeScript で書くと Node 20 には
 * 型剥がしが無く、Node 22 でも版によっては既定で有効ではないので
 * `Unknown file extension ".ts"` で落ちる（CI の Node 20 / 22 で実際に落とした）。
 * だから worker は `.mjs` で、PDFium 以外に依存を持たない。画素は転送可能
 * オブジェクトとして受け取るので、複製は起きない。
 */

import { Worker } from 'node:worker_threads';
import { DEFAULT_IMAGE_QUALITY, MAX_IMAGE_PIXELS, MAX_IMAGE_RESPONSE_BYTES } from '../constants.js';
import { readPdfFile, resolvePageNumbers } from '../utils/pdf-helpers.js';
import { encodeJpeg, encodePng } from './image-encoder.js';
import { downscale, type Samples } from './image-resampler.js';

/** One rendered page, as an encoded image file. */
export interface RenderedPage {
  page: number;
  /** Pixel size of the returned image. */
  width: number;
  height: number;
  /** The page's size in PDF points (1/72 inch), as PDFium reports it. */
  pointWidth: number;
  pointHeight: number;
  /** The dpi the returned image works out to, after any downscale. */
  effectiveDpi: number;
  mimeType: string;
  encodedBytes: number;
  dataBase64: string;
}

/** A page that was not rendered, and why. */
export interface OmittedRender {
  page: number;
  reason: string;
}

export interface RenderResult {
  pages: RenderedPage[];
  omitted: OmittedRender[];
  totalEncodedBytes: number;
}

export interface RenderOptions {
  /** Rasterisation density. Default 150 — text is legible, files stay small. */
  dpi?: number;
  /**
   * 1 ページの描画に許す時間（ミリ秒）。既定 20,000。
   * 越えたページは描画を止め、`omitted` に理由を書いて次へ進む。
   * 環境変数 `PDF_READER_RENDER_TIMEOUT_MS` でも変えられる。
   */
  pageTimeoutMs?: number;
  /** Cap on the rendered width in pixels; overrides dpi when smaller. */
  maxWidth?: number;
  format?: 'png' | 'jpeg';
  quality?: number;
  /** Response budget override, for tests. */
  maxTotalBytes?: number;
}

export const DEFAULT_RENDER_DPI = 150;

/**
 * 1 ページの描画に許す時間。20 秒。
 * 大きいページを高い dpi で描くのは正当に数秒かかるので、それより十分長く取る。
 * 越えたページは「時間内に描画できなかった」として申告し、次のページへ進む。
 */
export const DEFAULT_PAGE_TIMEOUT_MS = 20_000;

/** The pdfium module, loaded once. `null` after a failed attempt. */
let pdfiumLibrary: unknown | null | undefined;

/**
 * Load `@hyzyla/pdfium` if it is installed.
 *
 * The import is dynamic and by variable so that neither TypeScript nor a
 * bundler resolves it at build time: the package is optional, and the server
 * must start (and every other tool must work) without it.
 */
async function loadPdfium(): Promise<unknown | null> {
  if (pdfiumLibrary !== undefined) return pdfiumLibrary;
  try {
    const specifier = '@hyzyla/pdfium';
    const module = (await import(specifier)) as {
      PDFiumLibrary: { init(): Promise<unknown> };
    };
    pdfiumLibrary = await module.PDFiumLibrary.init();
  } catch {
    pdfiumLibrary = null;
  }
  return pdfiumLibrary;
}

/** True when the renderer is available in this installation. */
export async function rendererAvailable(): Promise<boolean> {
  return (await loadPdfium()) !== null;
}

export const RENDERER_MISSING_MESSAGE =
  'render_page needs the optional dependency @hyzyla/pdfium (PDFium compiled to ' +
  'WebAssembly), which is not installed here. Install it next to this server — ' +
  '`npm install @hyzyla/pdfium` — and call again. Every other tool works without it.';

/** BGRA (PDFium's output order) to RGB, dropping alpha against white. */
function bgraToRgb(width: number, height: number, bgra: Uint8Array): Samples {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const alpha = bgra[i * 4 + 3] / 255;
    // PDFium fills the bitmap with opaque white before drawing, so alpha is
    // normally 255; the blend is kept for the transparent-background case.
    data[i * 3] = Math.round(bgra[i * 4 + 2] * alpha + 255 * (1 - alpha));
    data[i * 3 + 1] = Math.round(bgra[i * 4 + 1] * alpha + 255 * (1 - alpha));
    data[i * 3 + 2] = Math.round(bgra[i * 4] * alpha + 255 * (1 - alpha));
  }
  return { width, height, channels: 3, data };
}

/**
 * Render the requested pages to PNG or JPEG.
 *
 * Pages are rendered in order until the byte budget is reached; the rest are
 * reported in `omitted` with the reason, mirroring `read_images` (#22).
 */
export async function renderPages(
  filePath: string,
  pages: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  if (!(await rendererAvailable())) throw new Error(RENDERER_MISSING_MESSAGE);

  const format = options.format ?? 'png';
  const quality = options.quality ?? DEFAULT_IMAGE_QUALITY;
  const budget = options.maxTotalBytes ?? MAX_IMAGE_RESPONSE_BYTES;
  const fromEnv = Number(process.env.PDF_READER_RENDER_TIMEOUT_MS);
  const timeoutMs =
    options.pageTimeoutMs ??
    (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_PAGE_TIMEOUT_MS);

  // 🔴 ページ番号の解決とファイルの読み込みは、ここで済ませる。Worker は
  // 型剥がしで動くので、`enum` を持つ constants.js に届く module を import できない。
  const bytes = await readPdfFile(filePath);

  // 🔴 拡張子は .mjs 固定。src からも dist からも、Node がそのまま実行できる形。
  const workerUrl = new URL('./page-renderer.worker.mjs', import.meta.url);

  const rendered: RenderedPage[] = [];
  const omitted: OmittedRender[] = [];
  let totalEncodedBytes = 0;
  let planned: number[] | null = null;
  let inFlight: number | null = null;

  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(workerUrl, {
      workerData: {
        bytes,
        dpi: options.dpi ?? DEFAULT_RENDER_DPI,
        maxWidth: options.maxWidth,
        maxPixels: MAX_IMAGE_PIXELS,
      },
    });

    let timer: NodeJS.Timeout;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve();
    };

    /**
     * 🔴 時限はメッセージが届くたびに引き直す。1 ページごとの予算であって、
     * 呼び出し全体の予算ではない —— 10 ページを 5 秒ずつ描くのは正常な仕事である。
     */
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // 止まったページと、まだ始まっていないページを、理由付きで申告する。
        // 🔴 黙って落とすと「描画するものが無かった」と見分けが付かなくなる。
        const stuck = inFlight;
        if (stuck !== null) {
          omitted.push({
            page: stuck,
            reason:
              `rendering did not finish within ${timeoutMs} ms and was stopped. ` +
              'A page can take unbounded time to rasterise — for example a tiling ' +
              'pattern (ISO 32000-2 §8.7.3.1) whose /XStep or /YStep is a near-zero ' +
              'magnitude, which asks for an astronomical number of tiles. Lower dpi ' +
              'or pass max_width if the page is merely large; otherwise this page ' +
              'cannot be rasterised here.',
          });
        }
        for (const page of planned ?? []) {
          if (stuck !== null && page > stuck) {
            omitted.push({
              page,
              reason: `not attempted — rendering stopped at page ${stuck}.`,
            });
          }
        }
        finish();
      }, timeoutMs);
    };
    arm();

    worker.on('message', (message: Record<string, unknown>) => {
      arm();
      switch (message.t) {
        case 'pagecount': {
          try {
            planned = resolvePageNumbers(pages, message.pageCount as number);
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          worker.postMessage({ pageNumbers: planned });
          return;
        }
        case 'plan':
          planned = message.pageNumbers as number[];
          return;
        case 'start':
          inFlight = message.page as number;
          return;
        case 'bitmap': {
          // 画素を受け取ってから符号化する。ここは有界な仕事なので、
          // 止まる心配があるのは worker の側だけ。
          inFlight = null;
          const pageNumber = message.page as number;
          const pointWidth = message.pointWidth as number;
          let samples = bgraToRgb(
            message.width as number,
            message.height as number,
            message.data as Uint8Array,
          );
          if (options.maxWidth && samples.width > options.maxWidth) {
            samples = downscale(samples, options.maxWidth);
          }
          const encoded =
            format === 'jpeg'
              ? encodeJpeg(samples.width, samples.height, 3, samples.data, quality)
              : encodePng(samples.width, samples.height, 2, 8, samples.data);

          if (totalEncodedBytes + encoded.length > budget) {
            omitted.push({
              page: pageNumber,
              reason:
                `${encoded.length.toLocaleString()} bytes would take the response past the ` +
                `${budget.toLocaleString()}-byte budget. Render fewer pages per call, ` +
                'lower dpi, or pass format: "jpeg".',
            });
            arm();
            return;
          }

          totalEncodedBytes += encoded.length;
          rendered.push({
            page: pageNumber,
            width: samples.width,
            height: samples.height,
            pointWidth: Math.round(pointWidth),
            pointHeight: Math.round(message.pointHeight as number),
            effectiveDpi: Math.round((samples.width / pointWidth) * 72),
            mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
            encodedBytes: encoded.length,
            dataBase64: encoded.toString('base64'),
          });
          // 🔴 符号化のあとで時限を引き直す。符号化の時間を worker の予算から引かない。
          arm();
          return;
        }
        case 'omit':
          inFlight = null;
          omitted.push({ page: message.page as number, reason: message.reason as string });
          return;
        case 'done':
          finish();
          return;
      }
    });

    worker.on('error', (error) => finish(error));
    worker.on('exit', () => finish());
  });

  return { pages: rendered, omitted, totalEncodedBytes };
}
