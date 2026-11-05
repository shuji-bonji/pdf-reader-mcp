# Tasks

## 0. 前提

- [x] 0.1 人が proposal.md を承認している（1 本の PR で提案・仕様・実装・archive を進める。ブランチは `fix/family-error-contract`）

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/e2e/18-common-errors.test.ts` を足す。各 Scenario を 1 件以上のテストにし、名前を「SPEC-READER-COMMON-ERRORS-<3 桁> <Scenario 名>」で始める。ツールは McpServer に登録した実物を InMemoryTransport 越しに呼び、本文の JSON を見る（003 は 17 ツールを回す。実装では stdio ではなく InMemoryTransport にした）
- [x] 1.2 描画の部品が無い状態（001・002・004 の Scenario）と故障（001）は、`tests/tier1/common-errors.test.ts` で部品の読み込みを差し替えて確かめる。HTTP の失敗（005）は 1.1 の e2e で、127.0.0.1 に 404 を返すサーバーを立てて確かめた（`fetch` は差し替えない）
- [x] 1.3 既存のテストが日本語の文面や `retryable` の有無を固定していれば、新しい文面に合わせる（`tests/tier1/errors.test.ts` の 3 件を書き換えた。`tests/e2e/15-reading-scope.test.ts` の RS-6 は新しい文面でも通るので変えていない。期待の意味は変えない）
- [x] 1.4 変更前の `src/` で 1.1・1.2 が落ちることを確かめる

## 2. 実装

- [x] 2.1 `src/errors.ts`: `RENDERER_NOT_AVAILABLE` を足す。`retryable` の表（`Record<LawErrorCode, boolean>`）を置き、`makeError` が表から引く。`LawServiceError.retryable` を必須にし、`makeError` の `retryable` の引数を外す。`NEXT_ACTIONS` の `reason` を英語にする
- [x] 2.2 `src/utils/error-handler.ts`: 例外の名前で分ける関数を足し、描画の部品の文を分類に加える。`buildInferredError` の `hint` を英語にし、`INVALID_PDF`・`ENCRYPTED_PDF` の文面を design.md のとおりにする。`PdfReaderError` から `retryable` の引数を外す。`FETCH_FAILED` の既定の `next_actions` を `verify_url` にする
- [x] 2.3 `src/services/object-locator.ts`・`src/services/validation-service.ts` の文面を直す
- [x] 2.4 `src/tools/tier1/render-page.ts`・`src/services/page-renderer.ts`: 描画の部品が無いときは `RENDERER_NOT_AVAILABLE` を投げ、ハンドラは JSON で返す
- [x] 2.5 `npm run check:engines`・`npm run lint`・`npm run format`・`npm run typecheck`・`npm run build`・`npm run check:public-types`・`npm run test:fixtures`・`npm test`・`npm run test:e2e` が終了コード 0

## 3. 出力が変わらないことの確認

- [x] 3.1 変更前と変更後の `dist` を起動し、`tools/list` の差が無いことを確かめる
- [x] 3.2 pdf-agent-stack の `eval/e2e` の S6 を `PDF_E2E_READER_DIR` で手元のビルドに向けて回し、reader の 4 件と宣言に無いキーの 1 件が通ることを確かめる

## 4. 版と記録

- [x] 4.1 `CHANGELOG.md`（英語）の `[Unreleased]` に書く。版は人が決める
- [x] 4.2 `README.md` と `README.ja.md`、`docs/` にエラーの形の記述があれば両方を直す
- [x] 4.3 `record.md` を計画 §8 の書式で書く

## 5. 承認と取り込み（人が判断する）

- [ ] 5.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 5.2 マージの前に、同じ PR の中で `npx openspec archive family-error-contract --yes` を実行する
- [ ] 5.3 archive の後、正本 `openspec/specs/common-errors/spec.md` の先頭に front matter（`spec_id: READER`・`kind: common`・`introduced_by: family-error-contract`）と Purpose（50 文字以上）を書き足す（OpenSpec 1.14.1 は差分の front matter を写さない）。`ls openspec/changes` が `archive` だけであることを確かめる
- [ ] 5.4 `npx openspec validate --all && npx spec-ids check` が通る
