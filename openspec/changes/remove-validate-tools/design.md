# Design

## 仕様の制約とライブラリの制約

- 仕様の制約: 無し。削除するのは ISO 32000-2・ISO 14289 の解釈ではなく、本サーバが提供するツールの集合。2 ツールが根拠にしていた PDF/UA-1 §7.1（XMP の `dc:title`）や §7.3（Figure の代替テキスト）の判定は、pdf-verify-mcp の `validate_conformance` が担っている。
- ライブラリの制約: 無し。

## 消すものと残すもの

2 ツールの実装は、他のツールと共有している部品を使っている。共有していないものだけを消す。

| 部品 | 使っているツール | 扱い |
| --- | --- | --- |
| `validateTagged`・`validateMetadata`（validation-service） | 2 ツールだけ | 消す |
| `isValidPdfDate`（validation-service） | `validateMetadata` だけ | 消す |
| `compareStructure`（validation-service） | `compare_structure` | 残す |
| `analyzeTagsFromDoc`（pdfjs-service） | `validateTagged` だけ（`inspect_tags` は StructTreeRoot から読む別の実装） | 消す |
| `countImagesFromDoc`（pdfjs-service） | `validateTagged` と `summarize` | 残す |
| `ValidateTaggedSchema`・`ValidateMetadataSchema` | 2 ツールだけ | 消す（`CompareStructureSchema` は残す） |
| `formatTaggedValidationMarkdown`・`formatMetadataValidationMarkdown` | 2 ツールだけ | 消す |
| 型 `TaggedValidation`・`MetadataValidation`・`ValidationIssue` など | 2 ツールだけ（実装時に grep で確かめる） | 消す |

## 削除したツールを呼んだときの応答

本サーバは `@modelcontextprotocol/server` 2.x を使う。登録されていない名前の `tools/call` は、SDK が JSON-RPC のエラーとして返す（1.x はツール結果の `isError: true` だった）。この応答の形は SDK が決めるので、仕様には書かない。実測した応答を CHANGELOG の移行の注記に書く。

## 計器（`scripts/golden.mjs`）

- 呼び出しの一覧（`CALLS`）から 2 ツールを除く。`diff` は呼び出しの一覧が違うゴールデン同士の比較を拒むので（終了コード 2）、変更の前後の比較は、**新しい一覧で前後の両方を採り直して**行う。
- 自己検査（`t3`）の 3・4・5 は `validate_metadata` の `passed`・`failed`・`totalChecks` を書き換えて、分類 C（判定が変わった）と D（反証できなくなった）が出ることを確かめていた。2 ツールを消すと、分類 D を出すツールが無くなる。
  - 分類 C は、ページごとの抽出の申告（`states`）が `extracted` から降りたときにも出る。3 はこれで書き直す。
  - 分類 D を出すのは 2 ツールの規則だけだった。4・5 は消し、分類 D の定義は古いゴールデンを読むために残す（D の判定規則も 2 ツールの分だけ消す）。

## 受入テスト

`tests/tier1/tools-list.test.ts` を新しく作り、`McpServer` に `registerAllTools` で登録して `InMemoryTransport` 越しに `tools/list` を呼ぶ（`scripts/golden.mjs` と同じ組み方）。001 の 2 シナリオと 002 の 1 シナリオを、Scenario 名をテスト名にして書く。削除の前は 001 の 2 件と 002 が落ちることを確かめる。
