---
approved: 2026-11-08
pr: 55
implementation: required
targets: [extract-structured-text]
---

# Proposal

## Why

0.22.0（#52）から、`extract_structured_text` は `LBody` の中の入れ子のリストを親の `LI` の `text` に混ぜず、要素として出します。ところが親の `LI` の `pages` と `boxes`（`include_bbox: true`）は、いまも入れ子の項目を含む範囲です（#54）。`text` が指す範囲と `boxes` が指す範囲が食い違っています。

- pdf-writer-mcp 0.26.0 で作った入れ子のリスト（`- Parent one` の下に 2 項目）を 0.22.0 で読むと、`Parent one` の文字は y 741〜751 付近だけなのに、`boxes` は 705.3〜751.4 で、入れ子の 2 項目まで覆う。ツールの説明は `boxes` を `add_annotation` にそのまま渡せる形だと案内しているので、`Parent one` に印を付けると入れ子の 2 項目まで覆われる。
- 入れ子の項目が次のページに渡ると、親の `LI` の `pages` にそのページが入る（`Parent one` の文字はそのページに無い）。`pages` での絞り込みでも、そのページに親の項目が出てくる。
- 入れ子の `L` を親の `L` の直接の子に置く形（ISO 32000-2 §14.8.4.8.2、例 H.8.3）では、`LI` の `boxes` は前から入れ子を含まない。同じリストでも、置き場所で `LI` の範囲が変わっていた。pdf-writer-mcp は PDF/UA-2 の出力でこの形を書く予定（pdf-writer-mcp#20）なので、writer の 2 つの版の出力を読むと `LI` の範囲が食い違う。

`pdf-spec-mcp` で確かめた条文（2026-11-06、#54）は両方向に読めます。

- ISO 32000-2 §14.8.4.8.2 NOTE: "Lists can occur within the content of an LBody structure element. Such lists are not considered part of the hierarchy." 入れ子を含まない方向。
- ISO 32000-2 §14.8.5.4.5: TH・TD 以外の BLSE の content rectangle の高さは "the sum of the heights of all BLSEs it contains"。含む方向。ただし reader の `boxes`（`basis: "text-extent"`）は描かれた文字から測った範囲で、レイアウト属性の content rectangle そのものではない。

本人が A 案（`pages`・`boxes` も入れ子の `L` を除く）を選びました（2026-11-08）。

## What Changes

- `LI` の `pages` と `boxes`（`basis: "text-extent"`）を、その `LI` の下にある `L` の部分木を除いた marked content から測る。`text` を集める範囲（003 の `contentRefsOutsideLists`）と同じにする。`Lbl` は範囲に含める（`label` に出る、項目の一部なので）。
- ツールの説明と README（英語・日本語）に、項目の `pages`・`boxes` は入れ子の項目を含まず、入れ子の項目の範囲は入れ子の `L` の `boxes` が持つと書く。

### 変わる振る舞い

- 入れ子のリストを `LBody` の中に持つ `LI` の `pages` と `boxes`。
- `pages` での絞り込み（`pages` 引数）。入れ子の項目だけがあるページを指定すると、親の `LI` は返らない（入れ子の `L`・`LI` は返る）。

### 変わらない振る舞い

- `LI` 以外の要素の `pages`・`boxes`。入れ子の `L` 自身は下位項目を含む範囲のまま。外側の `L` も入れ子を含む。
- 入れ子のリストを親の `L` の直接の子に持つ形の出力（もともと `LI` の下に入れ子が無い）。
- 入れ子の無いリストの出力。
- `LI` がレイアウト属性の `/BBox` を宣言しているときの `basis: "layout-attribute-bbox"` の箱（ファイルの宣言をそのまま返す）。宣言と測った範囲を照らす `boxNote` は、測る範囲が変わるので、入れ子を含む `/BBox` を宣言した `LI` では「宣言が測った範囲を覆う」ままで、注意書きは出ない。
- `text`・`label`・`depth`・要素の並び。

### 対象外

- §14.8.5.4.5 の content rectangle を計算して返すこと。

## Capabilities

- `extract-structured-text`（ADDED: 004）

## 人が判断すること

- A 案（2026-11-08 に本人が決定）。
- 版。`pages` での絞り込みの結果が変わるので 0.23.0（minor）にする案。
