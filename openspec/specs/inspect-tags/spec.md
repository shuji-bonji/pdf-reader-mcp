# inspect-tags Specification

## Purpose
`inspect_tags` ツールが文書の構造木（ISO 32000-2 §14.7）を読み、役割の分布と深さを報告する振る舞いを定めます。この初版には、構造木を読めなかったことを「タグが無い」と答えない規則だけを書きます。

## Requirements

### Requirement: SPEC-READER-INSPECT-TAGS-001 鍵を導けない文書ではタグの有無を答えない

文書が暗号化されていて、空の利用者パスワードからファイルの暗号鍵を導けない（ISO 32000-2 §7.6.4.3.2）ときは、`isTagged` を `false` ではなく `null` にし、`maxDepth`・`totalElements`・`roleCounts` を 0 や空ではなく `null` にする（SHALL）。`note` に、鍵を導けないので構造木を読めなかったこと、タグの無い文書という意味ではないことを書く（SHALL）。markdown では「Tagged: No」と書かない（SHALL）。

#### Scenario: 鍵を導けない文書では isTagged が null

- **WHEN** タグ付きの文書を利用者パスワード付きで暗号化したファイルを渡す
- **THEN** `isTagged` は `null`、`totalElements` は `null`、`note` は構造木を読めなかったことを書いている

#### Scenario: markdown でもタグが無いとは書かない

- **WHEN** 同じファイルを markdown で求める
- **THEN** 本文に「not tagged」も「Tagged**: No」も無く、読めなかったことを書いている

#### Scenario: タグの無い暗号化されていない文書は今までどおり false

- **WHEN** タグの無い暗号化されていない文書を渡す
- **THEN** `isTagged` は `false`
