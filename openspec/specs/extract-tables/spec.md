---
spec_id: READER
kind: tool
introduced_by: tags-unreadable-when-key-not-derived
---
# extract-tables Specification

## Purpose
`extract_tables` ツールが構造木の `Table` 要素（ISO 32000-2 §14.8.4.8.3）を行と列に組み立てて返す振る舞いを定めます。この初版には、構造木を読めなかったことを「タグが無い」と答えない規則だけを書きます。

## Requirements

### Requirement: SPEC-READER-EXTRACT-TABLES-001 鍵を導けない文書ではタグの有無も表の数も答えない

文書が暗号化されていて、空の利用者パスワードからファイルの暗号鍵を導けない（ISO 32000-2 §7.6.4.3.2）ときは、`isTagged` を `false` ではなく `null` にし、`tables` と `totalTables` を空や 0 ではなく `null` にする（SHALL）。`note` に、鍵を導けないので構造木を読めなかったこと、タグの無い文書という意味ではないことを書き、タグの無い文書向けの案内（段組みを考えた読み方へ切り替える）を書かない（SHALL）。

#### Scenario: 鍵を導けない文書では isTagged と tables が null

- **WHEN** タグ付きの文書を利用者パスワード付きで暗号化したファイルを渡す
- **THEN** `isTagged` は `null`、`tables` は `null`、`totalTables` は `null`、`note` は構造木を読めなかったことを書いている

#### Scenario: タグの無い暗号化されていない文書は今までどおり false

- **WHEN** タグの無い暗号化されていない文書を渡す
- **THEN** `isTagged` は `false`、`tables` は空の配列

### Requirement: SPEC-READER-EXTRACT-TABLES-002 catalog を読めない文書ではタグの有無を答えない

trailer の `/Root` が指す catalog（ISO 32000-2 §7.7.2）を読めない（取り出すと例外になる、または辞書でない）ときは、`isTagged` を `false` ではなく `null` にし、数える項目を 0 や空ではなく `null` にする（SHALL）。`note` に、catalog を読めなかったこと、タグの無い文書という意味ではないことを書く（SHALL）。読めた catalog に `/MarkInfo` が無いときは、今までどおり `isTagged: false` を返す（SHALL）。

#### Scenario: Root が指すオブジェクトが無い

- **WHEN** `/Root` が存在しないオブジェクトを指す文書を渡す
- **THEN** `isTagged` は `null` で、`note` に `catalog` がある

#### Scenario: Root が辞書でないものを指す

- **WHEN** `/Root` が整数のオブジェクトを指す文書を渡す
- **THEN** `isTagged` は `null`

#### Scenario: 読めた catalog に MarkInfo が無い

- **WHEN** `/MarkInfo` の無い catalog を持つ文書を渡す
- **THEN** `isTagged` は `false`
