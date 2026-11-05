## ADDED Requirements

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
