---
approved:
pr:
implementation: required
targets: [get-metadata]
---

# Proposal

## Why

`get_metadata` は文書情報辞書（trailer の `/Info`、ISO 32000-2 §14.3.3）だけを読み、メタデータストリーム（XMP、§14.3.2）を読みません（#42・F-26）。PDF 2.0 の文書で `/Info` が無いと、XMP に題名と日付があっても `title`・`author`・`producer`・`creationDate`・`modificationDate` がすべて `null` になります。pdf-writer-mcp の `ensure_pdfa`（`pdfa-4f`）が出力した文書がこの形で、pdf-publish Skill の読み戻しは題名の照合で「題名が無い」と判定します。

2026-11-05 に 0.19.0 のビルドで、`%PDF-2.0`・`/Info` 無し・XMP に `dc:title`（「請求書 INV-2026-0915」）・`dc:creator`・`xmp:CreateDate`・`pdf:Producer` を持つ検体に呼んだ結果、8 項目（`title`・`author`・`subject`・`keywords`・`creator`・`producer`・`creationDate`・`modificationDate`）はすべて `null` でした。

§14.3.3 は、PDF 2.0 では `CreationDate` と `ModDate` を除いて文書情報辞書を文書レベルのメタデータに使うことを非推奨（deprecated）とし、ほかのメタデータにはメタデータストリームを使うべき（should）と定めています。Table 349 の注は、各キーに対応する XMP のプロパティを挙げています。

## What Changes

- catalog の `/Metadata` の XMP から、Table 349 の注が対応させているプロパティを読む（design.md の表）。
- 項目ごとに、値を `/Info` と XMP のどちらから取ったかを返す（`metadataSources`）。
- 両方にあって値が違う項目は、両方の値を `metadataConflicts` に並べる。日付は、書き方（`/Info` は `D:YYYYMMDDHHmmSSOHH'mm`、XMP は ISO 8601）ではなく表す時刻で比べる。
- どちらを `title` などに入れるかは、文書の版で決める（2026-11-05 本人の判断）。PDF 2.0 以降は XMP を先に、1.x は `/Info` を先に見て、無ければもう片方を使う。値は書かれた形のまま返す（日付の書き方をそろえない）。
- XMP を読めたか・無かったか・読めなかったかを `xmpMetadata` で返す。読めなかった（鍵を導けない・ストリームを復号できない）ときは、XMP に無いとは言わない。

### 変わる振る舞い

- `/Info` に無く XMP にある項目が、`null` ではなく XMP の値になる。
- PDF 2.0 以降の文書で `/Info` と XMP の値が違う項目は、`/Info` ではなく XMP の値になる。
- JSON の応答に `metadataSources`・`metadataConflicts`・`xmpMetadata` が加わる。markdown の応答に出どころの列と食い違いの節が加わる。

### 変わらない振る舞い

- PDF 1.x の文書で `/Info` に値がある項目の値。
- `pageCount`・`pdfVersion`・`isLinearized`・`isEncrypted`・`isTagged`・`hasSignatures`・`fileSize`。
- 値の書き方（日付を ISO 8601 などに直さない）。

### 対象外

- XMP の全文を返すこと（`summarize` の `include_xmp` がある）。
- `/Info` の `Trapped` と XMP の `pdf:Trapped`。
- どちらの値が正しいかの判定（reader は書いてあるものを返すだけで、判定しない）。

## Capabilities

- `get-metadata`（新規。`kind: tool`。ADDED: 001〜003）

起こす範囲は、文書レベルのメタデータの 8 項目を `/Info` と XMP から読むことだけです。`pageCount` などの項目は既存のテスト（`tests/e2e/01-tier1-basic.test.ts`）が固定していて、この変更では起こしません。

## 人が判断すること

- 版で優先を変えること（2026-11-05 に決めた）。§14.3.3 は PDF 2.0 でも `CreationDate`・`ModDate` を非推奨にしていません。この 2 項目も、ほかと同じく PDF 2.0 では XMP を先に見る案にしています。2 項目だけ `/Info` を先にする案もあります。
- `dc:creator` が複数の人（`rdf:Seq`）のとき、`author` に `; ` でつないで入れること。
- 版の判定に使うのは、応答の `pdfVersion`（catalog の `/Version` があればそれ、無ければヘッダー）であること。
