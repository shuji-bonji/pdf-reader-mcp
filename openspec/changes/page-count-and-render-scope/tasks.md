# Tasks

## 0. 前提

- [x] 0.1 人が proposal.md を承認している（4 件の変更を 1 本の PR で進める。ブランチは `fix/reader-0.20.0`。2026-11-05 15:50 にチャットで方針を選んだ。`approved` は人が書く）

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `/Count` と葉の数が違う検体を用意する
- [x] 1.2 `tests/e2e/23-page-count-and-render-scope.test.ts` を足し、各 Scenario を 1 件以上のテストにする。名前は「SPEC-READER-<機能>-<3 桁> <Scenario 名>」。描画の Scenario は描画の部品が無い環境では skip する（`13-render-page.test.ts` と同じ）。予算を越えた Scenario は `tests/tier1/render-page-scope.test.ts` で描画の結果を差し替えて確かめる
- [x] 1.3 変更前の `src/` で 1.2 が落ちることを確かめる（001 は今も通る。既定を変えないことを固定するテスト）

## 2. 実装

- [x] 2.1 `src/schemas/tier1.ts`: `GetPageCountSchema` に `response_format` を足す
- [x] 2.2 `src/tools/tier1/get-page-count.ts`: JSON のときに `/Count` とページ木をたどった結果を読む。ツール説明を直す
- [x] 2.3 `src/services/page-renderer.ts`: `RenderResult` に頼まれたページ（`requested`）を足す。`src/tools/tier1/render-page.ts`: 射程の節を書く

## 3. 確認

- [x] 3.1 `npm run check:engines`・`npm run lint`・`npm run format`・`npm run typecheck`・`npm run build`・`npm run check:public-types`・`npm run test:fixtures`・`npm test`・`npm run test:e2e` が終了コード 0
- [x] 3.2 変更前と変更後の `dist` の `tools/list` を比べ、差が `get_page_count` の `response_format` と説明文だけであることを確かめる
- [x] 3.3 `npx openspec validate --all && npx spec-ids check` が通る

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved` と `pr` を書く
- [ ] 4.2 マージの前に `npx openspec archive page-count-and-render-scope --yes` を実行する
