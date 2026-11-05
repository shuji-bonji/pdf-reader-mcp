---
approved:
pr:
implementation: required
targets: [inspect-tags, extract-tables, extract-structured-text]
---

# Proposal

## Why

利用者パスワード付きの暗号化 PDF（空のパスワードでは鍵を導けない文書）に対して、`inspect_tags`・`extract_tables`・`extract_structured_text` の 3 ツールが「タグが無い」と答えます（#39・F-01）。実際には、鍵を導けないので構造木を読めていません。同じ文書に対し、`inspect_fonts`・`inspect_signatures`・`inspect_structure`・`inspect_catalog`・`locate_objects` は「鍵を導けないので読めなかった。〜の無い文書ではない」と返しています。

2026-11-05 に 0.19.0 のビルドで、`tests/fixtures/tagged.pdf` を `qpdf --encrypt secret owner 256` で暗号化した文書に呼んだ結果:

| ツール | 応答 |
| --- | --- |
| `inspect_tags` | `{"isTagged": false, "rootTag": null, "maxDepth": 0, "totalElements": 0, "roleCounts": {}}`。markdown は「This PDF is not tagged. No structure tree available.」 |
| `extract_tables` | `"isTagged": false`、`"note": "Document is not tagged. ..."` |
| `extract_structured_text` | `scope.textExtraction.status` が `read`、`"isTagged": false`、`"elements": []`、「This document is not tagged ...」の note |
| `read_text`（比較） | `isError: true`、`code: "ENCRYPTED_PDF"` |

原因は、3 ツールの共通の入口（`src/services/struct-tree-service.ts`）が、鍵を導けないと catalog を読めないことを確かめずに `/MarkInfo /Marked` を読みにいき、読めなかった結果を `false` として使っていることです。`extract_structured_text` のツール説明は「構造木を読めなかったときは `isTagged` と `elements` を `false` と `[]` ではなく `null` にする」と書いていますが、構造木の読み取りが失敗として申告されないので、この経路に一度も入っていません。

`inspect_tags`・`extract_tables`・`extract_structured_text` の仕様はまだありません。この変更で 3 つの capability の初版を起こし、この振る舞いだけを書きます。

## What Changes

- `inspect_tags`・`extract_tables`: 鍵を導けないときは、`isTagged` を `null` にし、数える項目（`maxDepth`・`totalElements`・`roleCounts`、`tables`・`totalTables`）を 0 や空ではなく `null` にして、ほかの 5 ツールと同じ趣旨の `note`（鍵を導けないので構造木を読めなかった。タグの無い文書ではない）を付ける。成功応答のまま返す（`inspect_fonts` などと同じ）。
- `extract_structured_text`: 鍵を導けないときは、構造木の読み取りを失敗として扱い、`scope.textExtraction` に `failed`（`code: "ENCRYPTED_PDF"`）を書く。文字の観測も失敗する文書では、`read_text` と同じく `isError: true`・`code: "ENCRYPTED_PDF"` の応答になる（`bothHalves` の既存の振る舞い）。
- markdown でも「Tagged: No」ではなく「not read」と書く。

### 変わる振る舞い

- 鍵を導けない暗号化文書に対する上の 3 ツールの応答。`inspect_tags`・`extract_tables` は `isTagged: false` から `null` に、`extract_structured_text` は成功応答から `ENCRYPTED_PDF` のエラー応答に変わる。
- 型 `TagsAnalysis` と `TablesExtractionResult` の項目が `null` を取りうるようになる（`isTagged`・`maxDepth`・`totalElements`・`roleCounts`・`tables`・`totalTables`）。`TagsAnalysis` に `note` が加わる。

### 変わらない振る舞い

- 暗号化されていない文書と、空の利用者パスワードで鍵を導ける文書の応答（タグの無い文書は今までどおり `isTagged: false`）。
- 構造木の読み方・順序・`/ActualText` の扱い。

### 対象外

- 暗号化以外の理由で catalog を読めない文書（catalog が壊れている）を `false` と区別すること。いまは `getCatalog()` の失敗を `null` に畳んでいる。鍵の件と同じ形なので、次にこの 3 ツールを触る変更で起こす。
- reader に `password` 引数を足すこと（#43 で範囲外と決めている）。

## Capabilities

- `inspect-tags`（新規。`kind: tool`。ADDED: 001）
- `extract-tables`（新規。`kind: tool`。ADDED: 001）
- `extract-structured-text`（新規。`kind: tool`。ADDED: 001）

起こす範囲は、鍵を導けない文書の扱いだけです。構造木の読み方・表の組み立て・順序は、既存のテスト（`tests/e2e/04-tier2-structure.test.ts`・`10-tier2-structured-text.test.ts`）が固定していて、この変更では起こしません。

## 人が判断すること

- `extract_structured_text` を成功応答ではなくエラー応答にすること（2026-11-05 に、`read_text` と同じ形にすると決めた）。
