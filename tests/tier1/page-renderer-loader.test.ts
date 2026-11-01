/**
 * render_page の描画の部品（@hyzyla/pdfium）の読み込み（#34）
 *
 * 読み込みに失敗した結果をプロセスに覚えると、「入れて、もう一度呼んで」の案内に
 * 従っても起動し直すまで描画できない。読み込みを差し替えて、失敗は覚えず
 * 成功だけを使い回すことを測る。
 */
import { describe, expect, it } from 'vitest';
import { createPdfiumLoader } from '../../src/services/page-renderer.js';

/** `init()` を 1 回だけ持つ偽の部品 */
function fakeModule(library: object) {
  return { PDFiumLibrary: { init: async () => library } };
}

describe('render_page の描画の部品の読み込み', () => {
  it('SPEC-READER-RENDER-PAGE-001 読み込みに失敗した後で部品が入ると、次の呼び出しで読み込む', async () => {
    const library = { id: 'pdfium' };
    let installed = false;
    let calls = 0;
    const load = createPdfiumLoader(async () => {
      calls++;
      if (!installed) throw new Error("Cannot find package '@hyzyla/pdfium'");
      return fakeModule(library);
    });

    expect(await load()).toBeNull();
    installed = true;
    expect(await load()).toBe(library);
    expect(calls).toBe(2);
  });

  it('SPEC-READER-RENDER-PAGE-001 読み込みに成功した部品は 2 回目に読み込み直さない', async () => {
    const library = { id: 'pdfium' };
    let calls = 0;
    const load = createPdfiumLoader(async () => {
      calls++;
      return fakeModule(library);
    });

    const [a, b] = await Promise.all([load(), load()]);
    const c = await load();
    expect(a).toBe(library);
    expect(b).toBe(library);
    expect(c).toBe(library);
    expect(calls).toBe(1);
  });

  it('初期化（init）が失敗したときも覚えず、次の呼び出しでやり直す', async () => {
    const library = { id: 'pdfium' };
    let attempt = 0;
    const load = createPdfiumLoader(async () => ({
      PDFiumLibrary: {
        init: async () => {
          attempt++;
          if (attempt === 1) throw new Error('wasm init failed');
          return library;
        },
      },
    }));

    expect(await load()).toBeNull();
    expect(await load()).toBe(library);
  });
});
