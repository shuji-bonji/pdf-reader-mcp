---
approved:
pr:
implementation: required
targets: [extract-structured-text]
---

# Proposal

## Why

`extract_structured_text` は、`LBody` の中に置かれた入れ子のリスト（`L`）を、親の項目（`LI`）の `text` に混ぜて 1 件にします（#52）。入れ子の項目は要素として出てこず、入れ子の記号（`Lbl`）も親の `text` に入ります。

pdf-writer-mcp 0.25.0（#12・#18）は、入れ子のリストを親の項目の `LBody` の中に置きます。writer の構造木は正しく、`inspect_tags` では入れ子の `L > LI > (Lbl, LBody)` が見えます。読み取り側だけが畳んでいます。

- `src/services/struct-tree-service.ts` の `flatten` は、`LI` のとき `Lbl` 以外の子（= `LBody`）の文字を子孫まで含めて 1 つの文字列にする（`textOf(b, idToText, true)`）。`LBody` の下の入れ子の `L` の `Lbl` と `LBody` の文字も全部入る。
- そのあと `LI` の子を辿らない（`if (isTable || element.role === 'LI') return;`）。入れ子の `L` は要素として出ない。
- `Lbl` を除いているのは `LI` の直下の `Lbl` だけで、ツールの説明の「Lbl is reported in label, not mixed into text」が入れ子では成り立っていない。

入れ子のリストの置き場所は 2 通りあり、どちらも条文に根拠があります。

| 置き場所 | ISO 32000-1（PDF 1.7） | ISO 32000-2（PDF 2.0） |
|---|---|---|
| `LBody` の子 | §14.8.4.3.3 Table 336 の LBody: "It may either contain the content directly or have other BLSEs, perhaps including nested lists, as children." | §14.8.4.8.2 NOTE: "Lists can occur within the content of an LBody structure element. Such lists are not considered part of the hierarchy." |
| 親の `L` の直接の子 | 附属書の例 H.8.2 | §14.8.4.8.2: "the child L (list) structure elements shall be a direct child of its parent L (list) structure element or contained within a Div structure element belonging to the parent L (list)."（例 H.8.3） |

親の `L` の直接の子に置く形は、`L` が `CONTAINER_ROLES` に入っているので今も辿られます。この形の検体はフィクスチャにありませんでした。

## What Changes

- `LI` の `text` は、`LBody`（`Lbl` 以外の子）の文字のうち、入れ子の `L` の部分木を除いたものにする。
- `LI` の `Lbl` 以外の子の下にある `L` を、親の `LI` の直後に要素として出す。`depth` は `LI` の `depth + 1`（`LBody` は出力しないので数えない）。その中の `LI` は `L` の `depth + 1`。
  - `LBody` の中で `Div` などに包まれた `L` も同じに扱う（`L` に出会うまで子を降りる。`L` の中へは文字の集計では降りない）。
- 親の `L` の直接の子に置いた `L`（H.8.3 の形）は今の扱いのまま（`L` の子として `depth + 1`）。フィクスチャを足して固定する。
- Markdown の出力は `depth` で字下げしているので、入れ子の `L`・`LI` は親の項目より深く字下げされる。`formatStructuredTextMarkdown` は変えない。
- ツールの説明に、入れ子のリストの出し方を 1 項目足す。

### depth の付き方

`depth` は構造木の中の深さで、`LBody` だけを数えません。2 つの形で同じ規則を当てると、次のようになります。

| 形 | 親の `L` | 親の `LI` | 入れ子の `L` | 入れ子の `LI` |
|---|---|---|---|---|
| `LBody` の中（PDF 1.7 の条文の形・writer 0.25.0） | d | d+1 | d+2 | d+3 |
| 親の `L` の直接の子（PDF 2.0 の条文の形・H.8.3） | d | d+1 | d+1 | d+2 |

`inspect_tags` の木と比べると、`LBody` の中の形では、`LBody` の 1 段だけ `depth` が浅くなります。2 つの形で `depth` の数がそろわないのは、ファイルの構造木の形が違うからです（reader は観測した木を報告し、形をそろえません）。

### 変わる振る舞い

- 入れ子のリストを持つ文書で、`elements` の件数・親の `LI` の `text`・入れ子の要素の有無。

### 変わらない振る舞い

- 入れ子の無いリストの出力（A/B で確かめる）。
- `LI` の `pages`・`boxes`。入れ子の項目を含む範囲のまま（親の項目の領域は、その下位項目を含むため）。
- `/ActualText` を持つ `LBody` は、今どおり `/ActualText` をそのまま `text` にする（§14.9.4）。

## Capabilities

- `extract-structured-text`（ADDED: 003）

## 人が判断すること

- 受入の観点の「同じ depth の付き方で出る」を、「同じ規則（構造木の深さ。`LBody` は数えない）で付ける」と読んだ。2 つの形で数をそろえる（H.8.3 の形の入れ子の `L` を直前の `LI` の下に置き直す）読み方もあるが、それは並び順から親子を推し量ることになり、観測の報告ではなくなるので採らなかった
- 版。出力が変わるので 0.22.0（minor）を提案する
