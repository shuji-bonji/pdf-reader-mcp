# get-metadata Specification

## Purpose
`get_metadata` ツールが文書の題名・作成者・日付などの文書レベルのメタデータを返す振る舞いを定めます。この初版には、文書情報辞書（ISO 32000-2 §14.3.3）とメタデータストリーム（§14.3.2）の両方から 8 項目を読む規則だけを書きます。

## Requirements

### Requirement: SPEC-READER-GET-METADATA-001 文書情報辞書に無い項目はメタデータストリームから読む

`title`・`author`・`subject`・`keywords`・`creator`・`producer`・`creationDate`・`modificationDate` の 8 項目は、文書情報辞書と、catalog の `/Metadata` のメタデータストリームの両方から読む（SHALL）。XMP のプロパティは ISO 32000-2 Table 349 の注が対応させているもの（`dc:title`・`dc:creator`・`dc:description`・`pdf:Keywords`・`xmp:CreatorTool`・`pdf:Producer`・`xmp:CreateDate`・`xmp:ModifyDate`）とし、属性の形と要素の形の両方を読む（SHALL）。項目ごとに、値をどちらから取ったかを `metadataSources` に `info`・`xmp`・`null` で返す（SHALL）。

#### Scenario: 文書情報辞書の無い PDF 2.0 の文書で題名を XMP から読む

- **WHEN** 文書情報辞書が無く、XMP の `dc:title` に「請求書 INV-2026-0915」がある PDF 2.0 の文書を渡す
- **THEN** `title` は「請求書 INV-2026-0915」、`metadataSources.title` は `xmp`

#### Scenario: 言語ごとの題名は x-default を使う

- **WHEN** `dc:title` の `rdf:Alt` に `x-default` と `en` の 2 つの項目がある
- **THEN** `title` は `x-default` の項目の値で、2 つをつないだ文字列ではない

#### Scenario: 属性の形で書かれたプロパティも読む

- **WHEN** `xmp:CreatorTool` が `rdf:Description` の属性として書かれている
- **THEN** `creator` はその値、`metadataSources.creator` は `xmp`

#### Scenario: 複数の作成者は区切ってつなぐ

- **WHEN** `dc:creator` の `rdf:Seq` に 2 人の名前がある
- **THEN** `author` は 2 人の名前を `; ` でつないだ文字列

### Requirement: SPEC-READER-GET-METADATA-002 どちらの値を使うかは文書の版で決め、食い違いは両方返す

文書情報辞書とメタデータストリームの両方に値がある項目は、`pdfVersion` が 2.0 以降ならメタデータストリームの値を、それより前なら文書情報辞書の値を使う（SHALL）。片方にしか無ければその値を使う（SHALL）。値は書かれた形のまま返し、日付の書き方をそろえない（SHALL）。両方の値が違う項目は、`metadataConflicts` に `{ field, info, xmp }` で並べる（SHALL）。日付は表す時刻で比べ、書き方だけが違うものを食い違いにしない（SHALL）。どちらの値が正しいかは判定しない。

#### Scenario: PDF 2.0 では XMP の値を使い、食い違いを返す

- **WHEN** 文書情報辞書の `Title` が「A」、XMP の `dc:title` が「B」の PDF 2.0 の文書を渡す
- **THEN** `title` は「B」、`metadataSources.title` は `xmp`、`metadataConflicts` に `{ field: "title", info: "A", xmp: "B" }` がある

#### Scenario: PDF 1.7 では文書情報辞書の値を使う

- **WHEN** 同じ値の組を持つ PDF 1.7 の文書を渡す
- **THEN** `title` は「A」、`metadataSources.title` は `info`、`metadataConflicts` に title の項目がある

#### Scenario: 同じ時刻を別の書き方で書いた日付は食い違いにしない

- **WHEN** 文書情報辞書の `CreationDate` が `D:20260915100000+09'00'`、XMP の `xmp:CreateDate` が `2026-09-15T10:00:00+09:00`
- **THEN** `metadataConflicts` に creationDate の項目は無い

### Requirement: SPEC-READER-GET-METADATA-003 メタデータストリームを読めなかったことを無いと言わない

メタデータストリームの状態を `xmpMetadata` に返す（SHALL）。catalog に `/Metadata` が無ければ `absent`、読めれば `read`、あるのに読めない（鍵を導けない・参照を解決できない・ストリームを復号できない）ときは `unreadable` と理由を返す（SHALL）。`unreadable` のとき、XMP の値が無いことを `absent` と同じ顔で返さない。

#### Scenario: /Metadata の無い文書は absent

- **WHEN** catalog に `/Metadata` が無い文書を渡す
- **THEN** `xmpMetadata.status` は `absent`

#### Scenario: XMP のある文書は read

- **WHEN** catalog に `/Metadata` があり、読める文書を渡す
- **THEN** `xmpMetadata.status` は `read`
