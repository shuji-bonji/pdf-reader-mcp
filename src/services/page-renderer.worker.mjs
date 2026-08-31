/**
 * `render_page` のラスタライズをこのスレッドで行う（#27）。
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
 *
 * ## 🔴 なぜ .mjs で、なぜ何も import しないか
 *
 * このファイルは Node が**そのまま**実行する。TypeScript で書くと、Node 20 には
 * 型剥がしが無く、Node 22 でも版によっては既定で有効ではないため
 * `Unknown file extension ".ts"` で落ちる（CI の Node 20 / 22 で実際に落とした）。
 *
 * 同じ理由で、この worker は `src` の module を 1 つも import しない。
 * import すると、試験では `.ts` を読むことになり同じ壁に当たる。
 * だからここでやるのは **PDFium で画素を作るところまで**で、
 * BGRA から RGB への変換・縮小・符号化は呼び出し側で行う。
 * 画素は転送可能オブジェクトとして渡すので、複製は起きない。
 *
 * `package.json` の `build` がこのファイルを `dist/services/` へ複製する。
 */

import { parentPort, workerData } from 'node:worker_threads';

const post = (message, transfer) => parentPort?.postMessage(message, transfer);

/** 呼び出し側がページ番号を解決して送り返してくるのを待つ。 */
function awaitPageNumbers() {
  return new Promise((resolve) => {
    parentPort?.once('message', (message) => resolve(message.pageNumbers));
  });
}

// 🔴 パッケージ名を変数にするのは、バンドラにここを解決させないため。
// @hyzyla/pdfium は optionalDependencies にあり、無くてもサーバは起動する。
const specifier = '@hyzyla/pdfium';
const module_ = await import(specifier);
const library = await module_.PDFiumLibrary.init();
const document_ = await library.loadDocument(new Uint8Array(workerData.bytes));

try {
  post({ t: 'pagecount', pageCount: document_.getPageCount() });
  const pageNumbers = await awaitPageNumbers();
  post({ t: 'plan', pageNumbers });

  for (const pageNumber of pageNumbers) {
    // 🔴 描画を始める前に名乗る。返らなくなったとき、どのページで止まったかを
    // 呼び出し側が言えるようにするため。
    post({ t: 'start', page: pageNumber });

    const page = document_.getPage(pageNumber - 1);
    const { originalWidth, originalHeight } = page.getOriginalSize();

    // dpi → scale: PDF points are 1/72 inch (ISO 32000-2 §8.3.2.3).
    let scale = workerData.dpi / 72;
    if (workerData.maxWidth && originalWidth * scale > workerData.maxWidth) {
      scale = workerData.maxWidth / originalWidth;
    }

    if (originalWidth * scale * originalHeight * scale > workerData.maxPixels) {
      post({
        t: 'omit',
        page: pageNumber,
        reason:
          `${Math.round(originalWidth * scale)}×${Math.round(originalHeight * scale)} at ` +
          `${workerData.dpi} dpi exceeds the ${workerData.maxPixels.toLocaleString()} pixel ` +
          'limit. Lower dpi or pass max_width.',
      });
      continue;
    }

    const bitmap = await page.render({ scale, render: 'bitmap' });
    // 画素は転送する（複製しない）。BGRA のまま渡し、変換は呼び出し側で行う。
    const data = new Uint8Array(bitmap.data);
    post(
      {
        t: 'bitmap',
        page: pageNumber,
        width: bitmap.width,
        height: bitmap.height,
        pointWidth: originalWidth,
        pointHeight: originalHeight,
        data,
      },
      [data.buffer],
    );
  }

  post({ t: 'done' });
} finally {
  document_.destroy();
}
