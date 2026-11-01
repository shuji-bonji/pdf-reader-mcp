# Design

## 何が起きているか

`src/services/page-renderer.ts` の `loadPdfium` は、モジュールの `let pdfiumLibrary` に、初期化した部品か、読み込みに失敗したことを示す `null` を入れ、2 回目以降は最初の行でそれを返す。

```ts
let pdfiumLibrary: unknown | null | undefined;
async function loadPdfium() {
  if (pdfiumLibrary !== undefined) return pdfiumLibrary;
  try { … pdfiumLibrary = await module.PDFiumLibrary.init(); }
  catch { pdfiumLibrary = null; }
  return pdfiumLibrary;
}
```

## 直し方

- 読み込みを `createPdfiumLoader(importModule)` に切り出す。`importModule` は部品のモジュールを返す関数で、既定は `import('@hyzyla/pdfium')`（指定子は変数のまま。ビルド時に解決させない理由は変えない）。
- 成功した結果は Promise ごと覚える（同時に 2 つ呼ばれても初期化は 1 回）。失敗したら覚えた Promise を捨て、`null` を返す。次の呼び出しは読み込みをやり直す。
- テストは `importModule` を差し替えて、1 回目に投げて 2 回目に成功する読み込み・成功の後に呼ばれないことを測る。

## ライブラリの制約

- Node の ESM は、解決に失敗した `import()`（`ERR_MODULE_NOT_FOUND`）をモジュールの表に載せないので、同じ指定子を次に `import()` すると解決をやり直す。部品を入れた後の 2 回目の `import()` が成功するかは、単体テスト（差し替えた読み込み）では測れないため、ビルドした `dist` を stdio で起動し、起動したまま部品を入れて呼ぶ手順で確かめる（record.md に結果を書く）。
- 部品が無い間は、`render_page` を呼ぶたびに失敗する `import()` が 1 回走る。部品が無いときの `render_page` は失敗する呼び出しなので、この費用は問題にしない。他のツールは部品を読まない。

## 仕様の制約

- ISO 32000-2 には関わらない（描画の部品の読み込みは本サーバの実行環境の話）。
