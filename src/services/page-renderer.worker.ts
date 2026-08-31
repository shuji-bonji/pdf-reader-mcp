/**
 * `render_page` の描画をこのスレッドで行う（#27）。
 *
 * ## なぜ別スレッドか
 *
 * PDFium は WASM の中で**同期に**走る。描画が終わらない文書があると、その間
 * イベントループごと止まり、サーバは応答を返さなくなる。1 秒ごとに印を出す
 * タイマーを仕掛けて描画を呼び、印が 1 つも出ないことを実測した。
 * JavaScript 側に時限を置いても割り込めない、ということである。
 *
 * 実例（veraPDF コーパス・TWG test suite A018-pdfa2-pass-b.pdf・3,461 バイト）:
 * タイリングパターン（ISO 32000-2 §8.7.3.1）の `/YStep` が **-1.175e-38**。
 * Table 74 は XStep / YStep について「正でも負でもよいが 0 であってはならない」と
 * 書いており、この値は 0 ではないので条文には反しない。ただし 1.175e-38 は
 * float32 で表せる最小の大きさで、その間隔で敷き詰めると 10^38 枚のタイルになる。
 * 500×500 ポイントの 1 ページで、20 分待っても返らなかった。
 *
 * `worker.terminate()` は止まった PDFium を実際に止められる（3 秒で exit を実測）。
 * だから描画をここに移し、呼び出し側が時限で切れるようにした。
 *
 * ## 🔴 import に注意
 *
 * このファイルは **試験では .ts のまま、公開物では .js として**同じ Worker から
 * 起動される。Node の型剥がし（strip-only）は `enum` を扱えないので、
 * `constants.ts` に届く経路（`pdf-helpers.ts` など）を import してはいけない。
 * ページ番号の解決とファイルの読み込みは呼び出し側で済ませ、必要な数値は
 * `workerData` で受け取る。同じディレクトリの module は拡張子を実行時に決めて
 * 動的 import する。
 */

import { parentPort, workerData } from 'node:worker_threads';

interface Samples {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
}

interface WorkerInput {
  bytes: Uint8Array;
  pages: string;
  dpi: number;
  maxWidth?: number;
  format: 'png' | 'jpeg';
  quality: number;
  budget: number;
  maxPixels: number;
}

const input = workerData as WorkerInput;
const post = (message: unknown) => parentPort?.postMessage(message);

const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const sibling = (name: string) => new URL(`./${name}.${extension}`, import.meta.url).href;

const { encodeJpeg, encodePng } = (await import(sibling('image-encoder'))) as {
  encodeJpeg(
    width: number,
    height: number,
    channels: number,
    data: Uint8Array,
    quality: number,
  ): Buffer;
  encodePng(
    width: number,
    height: number,
    colorType: number,
    depth: number,
    data: Uint8Array,
  ): Buffer;
};
const { downscale } = (await import(sibling('image-resampler'))) as {
  downscale(samples: Samples, maxWidth: number): Samples;
};

/** BGRA（PDFium の並び）から RGB へ。alpha は白に対して合成する。 */
function bgraToRgb(width: number, height: number, bgra: Uint8Array): Samples {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const alpha = bgra[i * 4 + 3] / 255;
    data[i * 3] = Math.round(bgra[i * 4 + 2] * alpha + 255 * (1 - alpha));
    data[i * 3 + 1] = Math.round(bgra[i * 4 + 1] * alpha + 255 * (1 - alpha));
    data[i * 3 + 2] = Math.round(bgra[i * 4] * alpha + 255 * (1 - alpha));
  }
  return { width, height, channels: 3, data };
}

interface PdfiumPageLike {
  getOriginalSize(): { originalWidth: number; originalHeight: number };
  render(options: { scale: number; render: 'bitmap' }): Promise<{
    width: number;
    height: number;
    data: Uint8Array;
  }>;
}
interface PdfiumDocumentLike {
  getPageCount(): number;
  getPage(index: number): PdfiumPageLike;
  destroy(): void;
}

/** 呼び出し側がページ番号を解決して送り返してくるのを待つ。 */
function awaitPageNumbers(): Promise<number[]> {
  return new Promise((resolve) => {
    parentPort?.once('message', (message: { pageNumbers: number[] }) => {
      resolve(message.pageNumbers);
    });
  });
}

// 🔴 パッケージ名を変数にするのは、TypeScript にもバンドラにもここを解決させないため。
// @hyzyla/pdfium は optionalDependencies にあり、無くてもサーバは起動する。
const specifier = '@hyzyla/pdfium';
const module_ = (await import(specifier)) as {
  PDFiumLibrary: {
    init(): Promise<{ loadDocument(data: Uint8Array): Promise<PdfiumDocumentLike> }>;
  };
};
const library = await module_.PDFiumLibrary.init();
const document_ = await library.loadDocument(new Uint8Array(input.bytes));

try {
  post({ t: 'pagecount', pageCount: document_.getPageCount() });
  const pageNumbers = await awaitPageNumbers();
  post({ t: 'plan', pageNumbers });

  let totalEncodedBytes = 0;
  for (const pageNumber of pageNumbers) {
    // 🔴 描画を始める前に名乗る。返らなくなったとき、どのページで止まったかを
    // 呼び出し側が言えるようにするため。
    post({ t: 'start', page: pageNumber });

    const page = document_.getPage(pageNumber - 1);
    const { originalWidth, originalHeight } = page.getOriginalSize();

    // dpi → scale: PDF points are 1/72 inch (ISO 32000-2 §8.3.2.3).
    let scale = input.dpi / 72;
    if (input.maxWidth && originalWidth * scale > input.maxWidth) {
      scale = input.maxWidth / originalWidth;
    }

    if (originalWidth * scale * originalHeight * scale > input.maxPixels) {
      post({
        t: 'omit',
        page: pageNumber,
        reason:
          `${Math.round(originalWidth * scale)}×${Math.round(originalHeight * scale)} at ` +
          `${input.dpi} dpi exceeds the ${input.maxPixels.toLocaleString()} pixel limit. ` +
          'Lower dpi or pass max_width.',
      });
      continue;
    }

    const bitmap = await page.render({ scale, render: 'bitmap' });
    let samples = bgraToRgb(bitmap.width, bitmap.height, bitmap.data);
    if (input.maxWidth && samples.width > input.maxWidth) {
      samples = downscale(samples, input.maxWidth);
    }

    const bytes =
      input.format === 'jpeg'
        ? encodeJpeg(samples.width, samples.height, 3, samples.data, input.quality)
        : encodePng(samples.width, samples.height, 2, 8, samples.data);
    const mimeType = input.format === 'jpeg' ? 'image/jpeg' : 'image/png';

    if (totalEncodedBytes + bytes.length > input.budget) {
      post({
        t: 'omit',
        page: pageNumber,
        reason:
          `${bytes.length.toLocaleString()} bytes would take the response past the ` +
          `${input.budget.toLocaleString()}-byte budget. Render fewer pages per call, ` +
          'lower dpi, or pass format: "jpeg".',
      });
      continue;
    }

    totalEncodedBytes += bytes.length;
    post({
      t: 'page',
      rendered: {
        page: pageNumber,
        width: samples.width,
        height: samples.height,
        pointWidth: Math.round(originalWidth),
        pointHeight: Math.round(originalHeight),
        effectiveDpi: Math.round((samples.width / originalWidth) * 72),
        mimeType,
        encodedBytes: bytes.length,
        dataBase64: bytes.toString('base64'),
      },
    });
  }

  post({ t: 'done', totalEncodedBytes });
} finally {
  document_.destroy();
}
