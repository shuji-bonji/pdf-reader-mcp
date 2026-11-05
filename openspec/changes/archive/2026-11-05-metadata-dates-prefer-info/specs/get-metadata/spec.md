## MODIFIED Requirements

### Requirement: SPEC-READER-GET-METADATA-002 どちらの値を使うかは文書の版で決め、食い違いは両方返す

文書情報辞書とメタデータストリームの両方に値がある項目は、`pdfVersion` が 2.0 以降ならメタデータストリームの値を、それより前なら文書情報辞書の値を使う（SHALL）。ただし `creationDate` と `modificationDate` は、版にかかわらず文書情報辞書の値を使う（SHALL）。ISO 32000-2 §14.3.3 は PDF 2.0 でもこの 2 つのキーを非推奨にしておらず、§14.5 は `PieceInfo` の `LastModified` を文書情報辞書の `ModDate` と比べると定めているからである。片方にしか無ければその値を使う（SHALL）。値は書かれた形のまま返し、日付の書き方をそろえない（SHALL）。両方の値が違う項目は、`metadataConflicts` に `{ field, info, xmp }` で並べる（SHALL）。日付は表す時刻で比べ、書き方だけが違うものを食い違いにしない（SHALL）。どちらの値が正しいかは判定しない。

#### Scenario: PDF 2.0 では XMP の値を使い、食い違いを返す

- **WHEN** 文書情報辞書の `Title` が「A」、XMP の `dc:title` が「B」の PDF 2.0 の文書を渡す
- **THEN** `title` は「B」、`metadataSources.title` は `xmp`、`metadataConflicts` に `{ field: "title", info: "A", xmp: "B" }` がある

#### Scenario: PDF 1.7 では文書情報辞書の値を使う

- **WHEN** 同じ値の組を持つ PDF 1.7 の文書を渡す
- **THEN** `title` は「A」、`metadataSources.title` は `info`、`metadataConflicts` に title の項目がある

#### Scenario: 同じ時刻を別の書き方で書いた日付は食い違いにしない

- **WHEN** 文書情報辞書の `CreationDate` が `D:20260915100000+09'00'`、XMP の `xmp:CreateDate` が `2026-09-15T10:00:00+09:00`
- **THEN** `metadataConflicts` に creationDate の項目は無い

#### Scenario: PDF 2.0 でも日付は文書情報辞書の値を使う

- **WHEN** 文書情報辞書の `CreationDate` が `D:20260915100000+09'00'`、`ModDate` が `D:20260916000000+09'00'`、XMP の `xmp:CreateDate` が `2026-09-15T10:00:00+09:00`、`xmp:ModifyDate` が `2026-09-16T00:00:00Z` の PDF 2.0 の文書を渡す
- **THEN** `creationDate` は `D:20260915100000+09'00'`、`modificationDate` は `D:20260916000000+09'00'`、2 つの `metadataSources` は `info`、`metadataConflicts` には modificationDate の項目だけがあり、その `xmp` は `2026-09-16T00:00:00Z`

#### Scenario: PDF 2.0 で日付が XMP にだけあれば XMP から読む

- **WHEN** 文書情報辞書が無く、XMP に `xmp:CreateDate` がある PDF 2.0 の文書を渡す
- **THEN** `creationDate` は XMP の値、`metadataSources.creationDate` は `xmp`
