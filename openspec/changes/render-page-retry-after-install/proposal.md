---
approved:
pr:
implementation: required
targets: [render-page]
---

# Proposal

## Why

`render_page` は、描画に使う任意の部品（`@hyzyla/pdfium`）が無いとき、次の文を返します（Issue #34）。

> render_page needs the optional dependency @hyzyla/pdfium … Install it next to this server — `npm install @hyzyla/pdfium` — and call again.

案内どおりに入れて同じプロセスにもう一度呼んでも、同じ文が返ります。`src/services/page-renderer.ts` の `loadPdfium` が、読み込みに失敗した結果（`null`）をプロセスが終わるまで覚えているためです。起動し直すと描画できます。Claude のデスクトップアプリや Claude Code は会話の間ずっと同じプロセスを使うので、利用者には「入れたのに動かない」と見えます。

2026-10-31 に npm の公開版 0.17.0 で再現しました（部品無しで呼ぶ → 同じプロセスのまま `npm i @hyzyla/pdfium` → 呼ぶ → 起動し直して呼ぶ。応答は「無い」「無い」「描画した」）。

## What Changes

- 部品の読み込みに成功した結果だけを覚え、失敗した結果は覚えない。次の呼び出しで読み込みをやり直す。
- `render-page` の capability を新しく作り、この振る舞いを要求 001 として書く。`render_page` の他の振る舞い（描画の寸法・形式・予算・時間切れ）は、この変更では起こさない。

### 変わる振る舞い

- 部品が無い状態で `render_page` を呼んだ後に部品を入れると、同じプロセスへの次の `render_page` で描画する。
- 部品が無い間は、`render_page` を呼ぶたびに部品の読み込みを試す（費用は失敗する `import()` 1 回）。

### 変わらない振る舞い

- 部品が無いときの応答の文（`RENDERER_MISSING_MESSAGE`）と `isError: true`。案内の「入れて、もう一度呼んで」は、この変更で事実になる。
- 部品があるときの描画。読み込みに成功した部品は、これまでどおり 1 回だけ初期化して使い回す。
- 他の 17 ツール（部品を使わない）。

### 対象外

- 描画の寸法・形式・予算・時間切れの要求（`tests/e2e/13-render-page.test.ts`・`16-render-timeout.test.ts` が測っている振る舞い）の初版起こし。`render_page` を次に触る変更で起こす。
- pdf-verify-mcp の veraPDF の探索（同じ形の問題。pdf-verify-mcp#24 で別に直す）。

### 人が判断すること

- 版。振る舞いの修正なので patch（0.17.1）を提案する。

## Capabilities

### New Capabilities

- `render-page`（`kind: tool`）: `render_page` ツール。この変更では「描画の部品の読み込み」だけを書く。

### Modified Capabilities

- なし

## Impact

- `src/services/page-renderer.ts`: 読み込みを `createPdfiumLoader(importModule)` に切り出し、成功だけを覚える。モジュールの既定の読み込みはこれを使う。
- テスト: `tests/tier1/page-renderer-loader.test.ts`（新規。部品の読み込みを差し替えて、失敗の後の再試行・成功の使い回しを測る。CI で回る）。
- 文書: CHANGELOG（英語）。
