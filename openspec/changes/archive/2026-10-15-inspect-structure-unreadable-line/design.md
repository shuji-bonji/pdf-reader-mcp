# Design

## 仕様の制約とライブラリの制約

- 仕様の制約: 無し。`unreadable` は ISO 32000-2 が定める値ではなく、本サーバが「相互参照表に載っているが読めなかった間接オブジェクト」を数えた観測値（SPEC-READER-INSPECT-STRUCTURE-005）。条文の確認は要らない。
- ライブラリの制約: 無し。数え上げ（`@normativepdf/recover` の `enumerateObjects`）は変えず、表示だけを変える。

## 変更点

`src/utils/formatter.ts` の `formatStructureMarkdown` で、`if (analysis.objectStats.unreadable > 0)` の条件を外し、`- **Unreadable**: ${analysis.objectStats.unreadable}` を常に push する。行の位置（`Streams` の次）は変えない。

## 受入テスト

`tests/tier1/utils.test.ts` に `formatStructureMarkdown` の単体テストを足す。`StructureAnalysis` を手で組み（`unreadable: 0` と `unreadable: 3`）、`Unreadable` の行の有無と位置を見る。E2E の検体は健全なものしか無く、`unreadable > 0` は手で組んだ入力でしか作れない。
