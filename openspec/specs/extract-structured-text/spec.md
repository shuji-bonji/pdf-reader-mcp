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
