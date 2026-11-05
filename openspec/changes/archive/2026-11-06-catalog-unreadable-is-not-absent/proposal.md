---
approved: 2026-11-06
pr: 51
implementation: required
targets: [inspect-tags, extract-tables, extract-structured-text, inspect-signatures]
---

# Proposal

## Why

catalog（trailer の `/Root` が指す辞書。ISO 32000-2 §7.7.2）を読めない文書で、`inspect_tags` などが「タグが無い」と答えます（#50）。各サービスが `doc.getCatalog().catch(() => null)` で失敗を `null` に畳み、その後の判定が `null` を「`/MarkInfo` が無い」と同じに扱うためです。#39（鍵を導けない暗号化文書）と同じ形です。

同じ形は 10 か所にあります。2 つの検体（`/Root` が指すオブジェクトが無い・`/Root` が整数を指す）で 0.20.1 の 9 ツールを呼んだ結果:

| ツール | 応答 | 読めなかったことを書いているか |
| --- | --- | --- |
| `get_page_count`・`get_metadata`・`summarize` | `INVALID_PDF` のエラー | 書いている（ページツリーに届かない） |
| `inspect_structure` | 「The page tree could not be resolved」の note | 書いている |
| `inspect_catalog` | 「The catalog dictionary could not be read」の note | 書いている |
| `inspect_tags` | `isTagged: false` | **書いていない** |
| `extract_tables` | `isTagged: false`、「Document is not tagged」 | **書いていない** |
| `extract_structured_text` | `isTagged: false`、「This document is not tagged」 | **書いていない** |
| `inspect_signatures` | `totalFields: 0`、「No AcroForm found in the document.」 | **書いていない** |

残りの 3 か所（`struct-tree-walker.ts`・`xmp-service.ts` の 2 か所）は、上のツールの手前でエラーになるか、上の 4 ツールの中から呼ばれる経路です。

## What Changes

catalog を読めない（`getCatalog()` が例外を投げる、または辞書でないものを返す）ときは:

- `inspect_tags`・`extract_tables`: #39 と同じく、`isTagged` を `null`、数える項目を `null` にし、`note` に「catalog を読めなかった。タグの無い文書ではない」と書く。
- `extract_structured_text`: #39 と同じく、構造木の読み取りを失敗として申告する（`code: "INVALID_PDF"`）。文字の観測が成功していれば成功の応答の `scope.textExtraction` が `failed` になり、`isTagged`・`elements` が `null` になる。両方失敗すればエラー応答。
- `inspect_signatures`: 鍵を導けない文書の既存の形（`totalFields: 0`・`note`）と同じく、`note` に「catalog を読めなかったので署名フィールドを探せなかった。署名の無い文書ではない」と書く。

### 変わる振る舞い

- catalog を読めない文書に対する上の 4 ツールの応答。

### 変わらない振る舞い

- catalog を読めた文書の応答（`/MarkInfo` が無い文書は今までどおり `isTagged: false`）。
- 鍵を導けない文書の応答（#39）。
- 残りの 5 ツールの応答。

### 対象外

- `inspect_signatures` の数を `null` にすること。鍵を導けない文書でも `0` と `note` で返していて、変えるなら両方を変える別の変更にする。
- catalog は読めて `StructTreeRoot` が読めない文書の扱い。

## Capabilities

- `inspect-tags`（ADDED: 002）
- `extract-tables`（ADDED: 002）
- `extract-structured-text`（ADDED: 002）
- `inspect-signatures`（新規。`kind: tool`。ADDED: 001。起こす範囲は、catalog を読めない文書の扱いだけ）

## 人が判断すること

- `inspect_signatures` は `null` ではなく、鍵を導けない文書と同じ `0` と `note` の形にすること。
- `extract_structured_text` の失敗の `code` を `INVALID_PDF`（文書が §7.7.2 に反している）にすること。
