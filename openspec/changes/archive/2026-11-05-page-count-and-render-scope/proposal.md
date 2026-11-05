---
approved: 2026-11-05
pr: 47
implementation: required
targets: [get-page-count, render-page]
---

# Proposal

## Why

`get_page_count` と `render_page` の成功応答には、どこまで読んだか（射程）がありません（#41・F-25）。

- `get_page_count` は本文に数値（`126`）だけを返す。引数 `response_format` も無いので、JSON で受け取る手がない。pdf-agent-stack の `eval/hosts/grok-build/00-grok-build-setup.md` のスモークの目安は「`pageCount` が 1」で、応答の形と食い違っている。
- `render_page` は描画したページの表と、描画しなかったページの理由（`## Not rendered`）を返すが、頼まれたページのうちどれを描画したかを、family 共通の見出し `## Scope of this reading` で申告していない。全ページを描画できたときは、射程の節そのものが出ない。

`get_page_count` の数は、pdfjs が返すページ数です。pdfjs は catalog の `/Pages` の `/Count`（ISO 32000-2 §7.7.3.2。木の葉の数の宣言）を使います。`/Count` と、ページ木を実際にたどって届いた葉の数は、書き手が誤ると食い違います（R-7.7.3.2-8 は書き手に一致を求めている）。数だけを返すと、どちらの数なのかが応答から分かりません。

## What Changes

- `get_page_count` に引数 `response_format`（`markdown` / `json`、既定は `markdown`）を足す。既定の応答は今までどおり数値だけにする（2026-11-05 本人の判断）。`json` のときは `{ pageCount, scope }` を返す。`scope` には、`/Count` の宣言（`declaredCount`）と、ページ木をたどって届いた葉の数（`pagesReached`）、ページ木をたどれたか（`pageTree`）を書く。
- `render_page` の本文に `## Scope of this reading` の節を足し、頼まれたページ・描画したページ・描画しなかったページと理由を書く（2026-11-05 本人の判断）。全ページを描画できたときも出す。画像はそのまま返す。

### 変わる振る舞い

- `get_page_count` の `tools/list` の `inputSchema` に `response_format` が加わる。
- `get_page_count` に `response_format: "json"` を渡すと、数値ではなく JSON のオブジェクトが返る。
- `render_page` の本文の最初に射程の節が加わる。

### 変わらない振る舞い

- `get_page_count` の既定（引数無し）の本文は数値だけ。数は今までどおり pdfjs のページ数で、`pages` の範囲の検査に使う数と同じ。
- `render_page` の画像・表・`## Not rendered` の節・予算と時間切れの振る舞い。
- エラー応答。

### 対象外

- `/Count` と届いた葉の数が食い違うときに、どちらを `pageCount` にするかを変えること。食い違いは `scope` で申告するだけにする。
- `render_page` に `response_format` を足すこと。

## Capabilities

- `get-page-count`（新規。`kind: tool`。ADDED: 001・002）
- `render-page`（ADDED: 002）

## 人が判断すること

- `get_page_count` の既定を数値のままにすること（2026-11-05 に決めた）。`response_format` の既定が `markdown` なのに本文が数値だけ、という名前と中身のずれが残ります。ほかのツールの markdown にそろえて「Pages: 126」のように書く案は、数値を読んでいる利用者を壊すので採っていません。
