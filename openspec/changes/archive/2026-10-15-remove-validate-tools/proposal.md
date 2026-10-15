---
approved: 2026-10-15
pr: 33
implementation: required
targets: [tools-list]
---

# Proposal

## Why

`validate_tagged` と `validate_metadata` は、PDF/UA などの規格に照らした合否を返すツールです。family の境界ルール（合否は pdf-verify-mcp、観測は本サーバ）の例外として、pdf-verify-mcp が無かった時代から残っていました。

- 0.7.0（2026-07-18）で、2 ツールの description に「次のメジャーで削除する」と予告し、pdf-verify-mcp の `validate_conformance` へ誘導しました（`docs/TASKS.md` B-1 のステップ 1・2）。
- pdf-verify-mcp の `validate_conformance` は 2 ツールの上位互換です。Figure の `/Alt`・`/ActualText` の実在、Link の `/Contents`、カタログの StructTreeRoot を直接確かめ、ISO 14289 の条項を付け、veraPDF があれば委譲します。
- 2 ツールには直さないと決めた既知の誤り（D-6・D-7）が残っています。`validate_metadata` は文書情報辞書だけを見て、PDF/UA-1 §7.1 が求める XMP の `dc:title` を見ていません。`validate_tagged` は Figure の数だけを数え、`/Alt` を読んでいません。

このまま残すと、利用者（LLM）が誤った合否を受け取り続けます。B-1 のステップ 3（削除）を行います。

## What Changes

- **BREAKING:** MCP の `tools/list` から `validate_tagged` と `validate_metadata` を除き、20 ツールを 18 ツールにします。
- 2 ツールだけが使っていた実装（入力スキーマ・サービス・Markdown 整形・型）と、それを測るテスト・計器の項目を消します。
- 横断の振る舞いを置く capability `tools-list` を新しく作り、「本サーバが返すツールの一覧」と「合否を返すツールを登録しない」ことを仕様にします。

### 変わる振る舞い

- `tools/list` が返すツールが 18 になる。
- `validate_tagged` / `validate_metadata` を `tools/call` で呼ぶと、ツールが無いことを示すエラーが返る（エラーの形は MCP SDK が決める。design.md に実測を書く）。

### 変わらない振る舞い

- 残る 18 ツールの入力と出力。`inspect_tags`（構造ツリーの報告）と `get_metadata`（メタデータの読み取り）はそのまま残す。
- `summarize` が数える画像の数（2 ツールと共有していた数え方は残す）。

### 対象外

- pdf-agent-stack 側の追随（サイトのツール一覧・自動生成のリファレンス・`stack.json`・翻訳メモリ）と、pdf-trust Skill の参照 4 か所（「非推奨」→「削除済み」）。別リポジトリの変更として後で行う。
- pdf-verify-mcp 側の変更（既に上位互換を持っている）。

### 人が判断すること

- **版の上げ方。** 予告の文は「next major version」だった。0.x の慣例どおり minor（0.17.0）にするか、1.0.0 にするか。
- **仕様の書き方。** 2 ツールは正本の仕様を持っていない（OpenSpec の導入より前のツール）。そのため「初版を起こしてから REMOVED にする」ことはせず、`tools-list` に「残る一覧」と「合否を返すツールを登録しない」を ADDED で書く。消したツールの記録は、この proposal と CHANGELOG に残す。
- 2 ツールだけが使っていた `isValidPdfDate`（ISO 32000-2 §7.9.4 の日付の形の検査）も消す。他に呼び出し元が無いため。必要になれば git の履歴から戻せる。

## Capabilities

### New Capabilities

- `tools-list`（`kind: common`）: 本サーバが MCP の `tools/list` で返すツールの集合。個々のツールの振る舞いは各ツールの capability に書き、ここには「どのツールがあるか」と「どのツールを置かないか」だけを書く。

### Modified Capabilities

- なし

## Impact

- 削除: `src/tools/tier3/validate-tagged.ts`・`validate-metadata.ts`、`src/schemas/tier3.ts` の 2 スキーマ、`src/services/validation-service.ts` の `validateTagged`・`validateMetadata`・`isValidPdfDate`、`src/services/pdfjs-service.ts` の `analyzeTagsFromDoc`、`src/utils/formatter.ts` の 2 整形関数、`src/types.ts` の 2 型。
- テスト: `tests/e2e/06-tier3-validation.test.ts` を消し、`08`・`09`・`constants.ts`・`tests/tier1/validation-service.test.ts` から 2 ツールの分を除く。`tests/verify-tier3.mjs` は `compare_structure` の分だけ残す。
- 計器: `scripts/golden.mjs` の呼び出し一覧から 2 ツールを除く。計器の自己検査（t3）のうち `validate_metadata` を壊していた 3 件を、残るツールで書き直す。
- 文書: README / README.ja のツール一覧、CLAUDE.md、`docs/TASKS.md` B-1、`src/index.ts` の説明、CHANGELOG。
- 利用者への影響: 2 ツールを呼んでいたクライアントはエラーになる。移行先は pdf-verify-mcp の `validate_conformance`（`flavour: "pdfua-1"` など）と、本サーバの `inspect_tags`・`get_metadata`。
