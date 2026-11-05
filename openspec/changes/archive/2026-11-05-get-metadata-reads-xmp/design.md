# Design

## 対応する XMP のプロパティ（ISO 32000-2 Table 349 の注）

| 応答の項目 | `/Info` のキー | XMP のプロパティ | XMP の形 |
| --- | --- | --- | --- |
| `title` | `Title` | `dc:title` | `rdf:Alt`（言語ごと） |
| `author` | `Author` | `dc:creator` | `rdf:Seq`（人ごと） |
| `subject` | `Subject` | `dc:description` | `rdf:Alt` |
| `keywords` | `Keywords` | `pdf:Keywords` | 文字列 |
| `creator` | `Creator` | `xmp:CreatorTool` | 文字列 |
| `producer` | `Producer` | `pdf:Producer` | 文字列 |
| `creationDate` | `CreationDate` | `xmp:CreateDate` | 日付（ISO 8601） |
| `modificationDate` | `ModDate` | `xmp:ModifyDate` | 日付（ISO 8601） |

名前空間は prefix ではなく URI で引きます（`dc` = `http://purl.org/dc/elements/1.1/`、`xmp` = `http://ns.adobe.com/xap/1.0/`、`pdf` = `http://ns.adobe.com/pdf/1.3/`）。プロパティは属性の形（`xmp:CreatorTool="..."`）と要素の形の両方を見ます（XMP Part 1 §7.9.2）。

- `rdf:Alt` は `xml:lang="x-default"` の項目を使い、無ければ最初の項目を使う。
- `rdf:Seq`・`rdf:Bag` は項目を `; ` でつなぐ。
- XML の文字参照（`&amp;`・`&#x...;` など）は戻す。

## 応答

```jsonc
{
  "title": "請求書 INV-2026-0915",
  // ...（今までの項目）
  "metadataSources": {
    "title": "xmp", "author": "xmp", "subject": null, "keywords": null,
    "creator": null, "producer": "xmp", "creationDate": "xmp", "modificationDate": "xmp"
  },
  "metadataConflicts": [
    { "field": "producer", "info": "Tool A", "xmp": "Tool B" }
  ],
  "xmpMetadata": { "status": "read" }   // "absent" / { "status": "unreadable", "reason": "..." }
}
```

- `metadataSources` の値は `"info"`・`"xmp"`・`null`（どちらにも無い）。
- `metadataConflicts` は食い違いが無ければ空の配列。日付は両方を時刻に直して比べ、同じ時刻なら食い違いにしない。どちらかを時刻に直せないときは、書かれた文字列で比べる。

## ライブラリの制約と仕様の制約

- ライブラリ（pdfjs）の制約: `getMetadata()` は XMP を解析した `metadata` も返すが、`rdf:Alt` の項目を区切りなしでつなぎ（`請求書 INV-2026-0915Invoice`）、属性の形のプロパティを読まない（2026-11-05 実測）。XMP は reader の `xmp-service.ts` で読む（`summarize` が宣言を読むのと同じ口）。`/Info` は今までどおり pdfjs の `info` から取る。
- ライブラリ（pdfjs）の制約: `PDFFormatVersion` は catalog の `/Version` があれば、ヘッダーより古くてもそれを返す（§7.2.2 は「ヘッダーより新しければ」）。版の判定はこの値で行い、ずれは対象外とする。
- 仕様の制約: §14.3.3 は PDF 2.0 で `/Info` の `CreationDate`・`ModDate` 以外を非推奨とし、XMP を使うべき（should）とする。§14.3.2 は catalog の `/Metadata` を文書レベルのメタデータストリームとする。
