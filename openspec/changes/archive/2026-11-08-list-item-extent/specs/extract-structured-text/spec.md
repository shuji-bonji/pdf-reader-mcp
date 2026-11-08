## ADDED Requirements

### Requirement: SPEC-READER-EXTRACT-STRUCTURED-TEXT-004 項目の pages と boxes は、入れ子のリストを含まない

`LI` の `pages` と、`include_bbox: true` のときの `boxes`（`basis: "text-extent"`）は、その `LI` の下にある `L` の部分木を除いた内容（`Lbl` と、`LBody` のうち入れ子の `L` の外の部分）から求める（SHALL）。入れ子の項目の範囲は、入れ子の `L` 自身の `pages`・`boxes` で返す（SHALL）。`LI` 以外の要素の `pages`・`boxes` は、子孫すべての内容から求めるまま変えない（SHALL）。根拠は ISO 32000-2 §14.8.4.8.2 NOTE（`LBody` の中のリストは階層の一部と見なさない）。003 で `text` から除いた範囲と同じ範囲を除くので、`text`・`pages`・`boxes` は同じものを指し、入れ子の `L` を親の `L` の直接の子に置く形（§14.8.4.8.2、例 H.8.3）と同じ範囲になる。

#### Scenario: LBody の中の入れ子のリストを持つ項目の boxes は、入れ子の項目を覆わない

- **WHEN** `L > LI > (Lbl "•", LBody > ("Parent one", L > (LI "Nested one", LI "Nested two")))` の構造木を持つ文書を `include_bbox: true` で読む
- **THEN** `Parent one` の `LI` の箱は、直後の入れ子の `L` の箱より上にあって重ならず、記号の位置（x = 60）を含む

#### Scenario: 入れ子のリストの置き場所が違っても、項目の範囲の高さは同じ

- **WHEN** 上の文書と同じ文書の、`L > (LI "Alpha", L > (LI "Alpha one", LI "Alpha two"), LI "Beta")` の部分を読む
- **THEN** `Alpha` の `LI` の箱の高さは `Parent one` の `LI` の箱の高さと同じで、`Alpha` の箱は直後の入れ子の `L` の箱と重ならない

#### Scenario: 入れ子の項目が次のページにあっても、親の項目の pages に入らない

- **WHEN** 1 ページ目に `Parent one` と `Nested one`、2 ページ目に `Nested two` があり、入れ子の `L` が `Parent one` の `LBody` の子にある文書を `include_bbox: true` で読む
- **THEN** `Parent one` の `LI` の `pages` は `[1]`、箱は 1 ページ目だけで、入れ子の `L` の `pages` は `[1, 2]`、箱は 1 ページ目と 2 ページ目

#### Scenario: 入れ子の L の範囲は下位項目を含む

- **WHEN** 最初の文書を `include_bbox: true` で読む
- **THEN** 入れ子の `L` の箱は `Nested one`・`Nested two` の `LI` の箱をどちらも含む
