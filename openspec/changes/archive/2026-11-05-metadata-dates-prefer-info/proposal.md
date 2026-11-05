---
approved: 2026-11-05
pr: 48
implementation: required
targets: [get-metadata]
---

# Proposal

## Why

0.20.0（`get-metadata-reads-xmp`）は、文書情報辞書（`/Info`、ISO 32000-2 §14.3.3）とメタデータストリーム（XMP、§14.3.2）の両方に値がある項目について、PDF 2.0 以降は 8 項目とも XMP の値を使います。2 つの日付（`creationDate`・`modificationDate`）については、この扱いが条文と合いません（2026-11-05 に pdf-spec-mcp で確認）。

- §14.3.3 が PDF 2.0 で非推奨にしたのは、文書情報辞書の `CreationDate` と `ModDate` **以外**のキーです。2 つの日付は `/Info` に書いてよいままです。
- Table 349 は、catalog に `PieceInfo` があるとき `ModDate` を必須としています。
- §14.5 は、`PieceInfo` のデータ辞書の `LastModified` を、文書情報辞書の `ModDate` と等しいかで比べ、データ辞書がいまの中身に対応しているかを判断すると定めています。PDF 2.0 でも、比べる相手として名指しされているのは `/Info` の `ModDate` です。

あわせて、値は書かれた形のまま返すと決めているので、両方を持つ文書では、同じ項目の書き方が版によって変わります（PDF 1.x は `D:20260915100000+09'00'`、PDF 2.0 は `2026-09-15T10:00:00+09:00`）。§14.3.3 の例そのもの（両方に同じ日付がある文書）でも、PDF 2.0 なら ISO 8601 の形で返ります。

## What Changes

- 両方に値があるとき、`creationDate` と `modificationDate` は、版にかかわらず文書情報辞書の値を使う（2026-11-05 本人の判断）。
- ほかの 6 項目は 0.20.0 と同じ（PDF 2.0 以降は XMP、それより前は文書情報辞書）。

### 変わる振る舞い

- PDF 2.0 以降の文書で、`/Info` と XMP の両方に日付があるとき、`creationDate`・`modificationDate` の値が XMP の値から `/Info` の値に変わり、`metadataSources` の値が `xmp` から `info` に変わる。書き方も `D:` の形になる。

### 変わらない振る舞い

- 片方にしか日付が無い文書（`/Info` の無い PDF 2.0 の文書では、今までどおり XMP から読む。#42 で見つかった形）。
- PDF 1.x の文書。ほかの 6 項目。
- `metadataConflicts` の中身（どちらを主の項目に入れても、食い違いは両方の値で並べる）。日付を時刻で比べること。
- `get_metadata` の引数と応答の項目。

### 対象外

- 日付の書き方をそろえること（書かれた形のまま返す決定は変えない）。
- `PieceInfo` の `LastModified` を読むこと。

## Capabilities

- `get-metadata`（MODIFIED: 002）

## 人が判断すること

- 版。値が変わるのは「PDF 2.0 以降で両方に日付がある文書」だけで、引数と応答の項目は変わらないので、patch（0.20.1）を提案します。
