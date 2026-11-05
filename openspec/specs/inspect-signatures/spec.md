---
spec_id: READER
kind: tool
introduced_by: catalog-unreadable-is-not-absent
---
# inspect-signatures Specification

## Purpose
`inspect_signatures` ツールが、文書の署名フィールド（ISO 32000-2 §12.7.5.5）を観測して報告するときの規則を定めます。この初版には、catalog を読めなかったことを「AcroForm が無い」「署名の無い文書」と答えない振る舞いだけを書きます。署名を検証して合否を言うのは pdf-verify-mcp の仕事で、このツールは観測だけを返します。

## Requirements

### Requirement: SPEC-READER-INSPECT-SIGNATURES-001 catalog を読めない文書では「AcroForm が無い」と答えない

trailer の `/Root` が指す catalog（ISO 32000-2 §7.7.2）を読めないときは、`note` に「No AcroForm found」と書かず、catalog を読めなかったので署名フィールドを探せなかったこと、署名の無い文書という意味ではないことを書く（SHALL）。数の項目は、鍵を導けない文書と同じく `0` にする。読めた catalog に `/AcroForm` が無いときは、今までどおり「No AcroForm found in the document.」と書く（SHALL）。

#### Scenario: Root が指すオブジェクトが無い

- **WHEN** `/Root` が存在しないオブジェクトを指す文書を渡す
- **THEN** `note` に `No AcroForm` が無く、`catalog` と `not a document without signatures` がある

#### Scenario: 読めた catalog に AcroForm が無い

- **WHEN** `/AcroForm` の無い catalog を持つ文書を渡す
- **THEN** `note` は `No AcroForm found in the document.`
