# Tasks

## 0. 前提

- [x] 0.1 人が proposal.md を承認している（4 件の変更を 1 本の PR で進める。ブランチは `fix/reader-0.20.0`。2026-11-05 15:50 にチャットで方針を選んだ。`approved` は人が書く）

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 鍵を導けない暗号化文書の検体を `tests/e2e/locked-specimens.ts` にバイト列で置く（`spanning-table.pdf` を qpdf で暗号化）
- [x] 1.2 `tests/e2e/20-tags-unreadable.test.ts` を足し、3 つの Requirement の Scenario を 1 件以上のテストにする。名前は「SPEC-READER-<機能>-001 <Scenario 名>」。ツールは McpServer に登録した実物を InMemoryTransport 越しに呼ぶ
- [x] 1.3 「構造木だけが読めなかった」Scenario は、文字の観測を成功させる検体が作れないので、`tests/tier1/tags-unreadable.test.ts` で文字の観測を成功に差し替えて確かめる
- [x] 1.4 変更前の `src/` で 1.2・1.3 が落ちることを確かめる

## 2. 実装

- [x] 2.1 `src/services/struct-tree-service.ts`: 3 つの入口で `lockedOut(scope)` を先に見る。`analyzeTags`・`extractTables` は `null` と `note` を返し、`extractStructuredText` は `ENCRYPTED_PDF` の `PdfReaderError` を投げる
- [x] 2.2 `src/types.ts`: `TagsAnalysis`・`TablesExtractionResult` の型を `null` を取りうるようにし、`TagsAnalysis` に `note` を足す
- [x] 2.3 `src/utils/formatter.ts`: markdown で `null` を「not read」と書く
- [x] 2.4 `extract_structured_text` のツール説明の暗号化の記述を確かめる（説明はすでに `null` の意味を書いている）

## 3. 確認

- [x] 3.1 `npm run check:engines`・`npm run lint`・`npm run format`・`npm run typecheck`・`npm run build`・`npm run check:public-types`・`npm run test:fixtures`・`npm test`・`npm run test:e2e` が終了コード 0
- [x] 3.2 `npx openspec validate --all && npx spec-ids check` が通る

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved` と `pr` を書く
- [ ] 4.2 マージの前に `npx openspec archive tags-unreadable-when-key-not-derived --yes` を実行し、正本 3 つの front matter と Purpose を確かめる
