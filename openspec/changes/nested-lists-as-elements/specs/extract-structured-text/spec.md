## ADDED Requirements

### Requirement: SPEC-READER-EXTRACT-STRUCTURED-TEXT-003 入れ子のリストは親の項目の text に混ぜず、要素として出す

`LI` の `text` は、`Lbl` 以外の子（`LBody`）の文字のうち、その下にある `L` の部分木を除いたものにする（SHALL）。`LI` の `Lbl` 以外の子の下にある `L`（`LBody` の子、または `LBody` の中の `Div` などの下）は、親の `LI` の直後に要素として出し、`depth` を `LI` の `depth + 1` にする（SHALL）。`LBody` は要素として出さず、`depth` にも数えない（SHALL）。親の `L` の直接の子にある `L` は、`L` の子として `depth + 1` で出す（SHALL）。どちらの形でも、入れ子の `LI` の記号は `label` に入り、親の `text` に入らない（SHALL）。入れ子の無いリストの出力は変えない（SHALL）。根拠は ISO 32000-1 §14.8.4.3.3 Table 336（LBody は入れ子のリストを子に持てる）と ISO 32000-2 §14.8.4.8.2（入れ子の `L` は親の `L` の直接の子、または親の `L` に属する `Div` の中に置く。NOTE: `LBody` の中にも置ける）。

#### Scenario: LBody の中の入れ子のリストを要素として出す

- **WHEN** `L > LI > (Lbl "•", LBody > ("Parent one", L > (LI "Nested one", LI "Nested two")))`、`LI "Parent two"` の構造木を持つ文書を渡す
- **THEN** 要素は `LI`（`depth` d、`text` は `Parent one`、`label` は `•`）・`L`（d+1）・`LI`（d+2、`Nested one`、`•`）・`LI`（d+2、`Nested two`、`•`）・`LI`（d、`Parent two`）の順に並ぶ

#### Scenario: 親の L の直接の子の入れ子のリストを要素として出す

- **WHEN** `L > (LI "Alpha", L > (LI "Alpha one", LI "Alpha two"), LI "Beta")` の構造木（ISO 32000-2 H.8.3 の形）を持つ文書を渡す
- **THEN** 要素は `LI`（`depth` d、`Alpha`）・`L`（d）・`LI`（d+1、`Alpha one`）・`LI`（d+1、`Alpha two`）・`LI`（d、`Beta`）の順に並び、どの `text` にも記号が入らない

#### Scenario: 入れ子の無いリストは変わらない

- **WHEN** 入れ子の無いリストを持つ既存のフィクスチャ（`structured.pdf`）を渡す
- **THEN** `L` と `LI` の要素は変更前と同じ（`LI` が 2 件、`text` は `First item`・`Second item`）

#### Scenario: Markdown でも入れ子の項目を親より深く字下げする

- **WHEN** LBody の中の入れ子のリストを持つ文書を `response_format: "markdown"` で読む
- **THEN** `Nested one` の行は `Parent one` の行より深く字下げされ、`Parent one` の行に `Nested` が入らない
