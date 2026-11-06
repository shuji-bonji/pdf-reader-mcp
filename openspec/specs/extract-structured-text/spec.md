---
spec_id: READER
kind: tool
introduced_by: tags-unreadable-when-key-not-derived
---
# extract-structured-text Specification

## Purpose
`extract_structured_text` ツールが構造木を論理的な内容の順（ISO 32000-2 §14.8.2.5）にたどり、要素ごとの文字を返す振る舞いを定めます。この初版には、構造木を読めなかったことを読み取りの失敗として申告する規則だけを書きます。

## Requirements

### Requirement: SPEC-READER-EXTRACT-STRUCTURED-TEXT-001 鍵を導けない文書では構造木の読み取りを失敗として申告する

文書が暗号化されていて、空の利用者パスワードからファイルの暗号鍵を導けない（ISO 32000-2 §7.6.4.3.2）ときは、構造木の読み取りを失敗として扱い、`isTagged: false` と空の `elements` を返さない（SHALL）。文字の観測（§9.10.1）が成功していれば、成功応答の `scope.textExtraction` を `failed`（`code: "ENCRYPTED_PDF"`）にし、`isTagged` と `elements` を `null` にする（SHALL）。文字の観測も失敗していれば、`read_text` と同じく `isError: true` で `code: "ENCRYPTED_PDF"` を返す（SHALL）。

#### Scenario: 鍵を導けない文書では ENCRYPTED_PDF のエラーになる

- **WHEN** タグ付きの文書を利用者パスワード付きで暗号化したファイルを渡す
- **THEN** `isError` は `true`、`code` は `ENCRYPTED_PDF`

#### Scenario: 構造木だけが読めなかったときは isTagged が null

- **WHEN** 構造木の読み取りが鍵を導けずに失敗し、文字の観測は成功する
- **THEN** `scope.textExtraction.status` は `failed`、`code` は `ENCRYPTED_PDF`、`isTagged` と `elements` は `null`

### Requirement: SPEC-READER-EXTRACT-STRUCTURED-TEXT-002 catalog を読めない文書では構造木の読み取りを失敗として申告する

trailer の `/Root` が指す catalog（ISO 32000-2 §7.7.2）を読めないときは、構造木の読み取りを失敗（`code: "INVALID_PDF"`）として扱い、`isTagged: false` と空の `elements` を返さない（SHALL）。文字の観測が成功していれば成功の応答の `scope.textExtraction` を `failed` にし、`isTagged` と `elements` を `null` にする（SHALL）。

#### Scenario: Root が指すオブジェクトが無い

- **WHEN** `/Root` が存在しないオブジェクトを指す文書を渡す
- **THEN** 応答に `isTagged: false` が無い（成功の応答なら `isTagged` は `null` で `scope.textExtraction.status` は `failed`、エラー応答なら `code` は `INVALID_PDF`）

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
