# Tasks

## 0. 前提

- [x] 0.1 人が proposal.md を承認している（2026-11-05 19:28 にチャットで方針を選んだ。`approved` は人が書く。ブランチは `fix/metadata-dates-prefer-info`）

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/e2e/22-get-metadata-xmp.test.ts` に、追加した 2 つの Scenario のテストを足す。名前は「SPEC-READER-GET-METADATA-002 <Scenario 名>」
- [x] 1.2 変更前の `src/` で「PDF 2.0 でも日付は文書情報辞書の値を使う」が落ちることを確かめる（「XMP にだけあれば XMP から読む」は変わらない振る舞いを固定するので通る）

## 2. 実装

- [x] 2.1 `src/services/pdfjs-service.ts` の `mergeDocumentMetadata`: 2 つの日付は版にかかわらず文書情報辞書を先にする
- [x] 2.2 `get_metadata` のツール説明と README（英日）の記述を直す

## 3. 確認

- [x] 3.1 `npm run check:engines`・`npm run lint`・`npm run format`・`npm run typecheck`・`npm run build`・`npm run check:public-types`・`npm run test:fixtures`・`npm test`・`npm run test:e2e` が終了コード 0
- [x] 3.2 `npx openspec validate --all && npx spec-ids check` が通る

## 4. 承認と取り込み（人が判断する）

- [x] 4.1 人が `proposal.md` の front matter に `approved` と `pr` を書く
- [x] 4.2 マージの前に `npx openspec archive metadata-dates-prefer-info --yes` を実行する（既存の capability の MODIFIED なので、正本の front matter は残るはず。`npx spec-ids check` で確かめる）
