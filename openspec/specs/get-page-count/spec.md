# get-page-count Specification

## Purpose
`get_page_count` ツールが文書のページ数を返す振る舞いを定めます。この初版には、応答の形（既定の数値と JSON）と、ページ数の宣言とページ木をたどった結果を射程として返す規則を書きます。

## Requirements

### Requirement: SPEC-READER-GET-PAGE-COUNT-001 既定の応答は数値だけにする

`response_format` を渡さないとき、または `markdown` を渡したときは、本文にページ数の数値だけを書く（SHALL）。この数は、ほかのツールが `pages` の範囲を検査するのに使う数と同じにする（SHALL）。

#### Scenario: 引数無しでは数値だけ

- **WHEN** 1 ページの文書を `response_format` 無しで渡す
- **THEN** 本文は `1`

### Requirement: SPEC-READER-GET-PAGE-COUNT-002 JSON ではページ数の宣言とたどった結果を射程として返す

`response_format: "json"` のときは、`{ pageCount, scope }` のオブジェクトを返す（SHALL）。`scope` には、catalog の `/Pages` の `/Count`（ISO 32000-2 §7.7.3.2）の値を `declaredCount` に、ページ木をたどって届いた葉の数を `pagesReached` に、ページ木をたどれたかを `pageTree`（`{ status: "read" }` か `{ status: "failed", code, reason }`）に書く（SHALL）。読めなかった値は 0 ではなく `null` にする（SHALL）。2 つの数が違っても、どちらが正しいかは判定しない。

#### Scenario: JSON では pageCount と scope を返す

- **WHEN** 1 ページの文書を `response_format: "json"` で渡す
- **THEN** `pageCount` は `1`、`scope.declaredCount` は `1`、`scope.pagesReached` は `1`、`scope.pageTree.status` は `read`

#### Scenario: /Count が葉の数と違えば両方を返す

- **WHEN** ページ木の葉が 2 つで、`/Pages` の `/Count` が 3 の文書を `response_format: "json"` で渡す
- **THEN** `scope.declaredCount` は `3`、`scope.pagesReached` は `2`
