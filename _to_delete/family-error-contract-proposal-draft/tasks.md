# Tasks

## 0. 前提

- [ ] 0.1 人が proposal.md を承認している（1 本の PR で提案・仕様・実装・archive を進める。ブランチは `fix/family-error-contract`）

## 1. 受入テスト（先に落ちることを確かめる）

- [ ] 1.1 `tests/e2e/18-common-errors.test.ts` を足す。各 Scenario を 1 件以上のテストにし、名前を「SPEC-READER-COMMON-ERRORS-<3 桁> <Scenario 名>」で始める。ツールは stdio で起動した実物を呼び、本文の JSON を見る（003 は 17 ツールを回す）
- [ ] 1.2 描画の部品が無い状態（002・004 の Scenario）と HTTP の失敗（005）は、`tests/tier1/` の単体テストで、部品の読み込みと `fetch` を差し替えて確かめる
- [ ] 1.3 既存のテストが日本語の文面や `retryable` の有無を固定していれば、新しい文面に合わせる（`tests/tier1/errors.test.ts`・`tests/e2e/15-reading-scope.test.ts` の RS-6 など。期待の意味は変えない）
- [ ] 1.4 変更前の `src/` で 1.1・1.2 が落ちることを確かめる

## 2. 実装

- [ ] 2.1 `src/errors.ts`: `RENDERER_NOT_AVAILABLE` を足す。`retryable` の表（`Record<LawErrorCode, boolean>`）を置き、`makeError` が表から引く。`LawServiceError.retryable` を必須にし、`makeError` の `retryable` の引数を外す。`NEXT_ACTIONS` の `reason` を英語にする
- [ ] 2.2 `src/utils/error-handler.ts`: 例外の名前で分ける関数を足し、描画の部品の文を分類に加える。`buildInferredError` の `hint` を英語にし、`INVALID_PDF`・`ENCRYPTED_PDF` の文面を design.md のとおりにする。`PdfReaderError` から `retryable` の引数を外す。`FETCH_FAILED` の既定の `next_actions` を `verify_url` にする
- [ ] 2.3 `src/services/object-locator.ts`・`src/services/validation-service.ts` の文面を直す
- [ ] 2.4 `src/tools/tier1/render-page.ts`・`src/services/page-renderer.ts`: 描画の部品が無いときは `RENDERER_NOT_AVAILABLE` を投げ、ハンドラは JSON で返す
- [ ] 2.5 `npm run check:engines`・`npm run lint`・`npm run format`・`npm run typecheck`・`npm run build`・`npm run check:public-types`・`npm run test:fixtures`・`npm test`・`npm run test:e2e` が終了コード 0

## 3. 出力が変わらないことの確認

- [ ] 3.1 変更前と変更後の `dist` を起動し、`tools/list` の差が無いことを確かめる
- [ ] 3.2 pdf-agent-stack の `eval/e2e` の S6 を `PDF_E2E_READER_DIR` で手元のビルドに向けて回し、reader の 4 件と宣言に無いキーの 1 件が通ることを確かめる

## 4. 版と記録

- [ ] 4.1 `CHANGELOG.md`（英語）の `[Unreleased]` に書く。版は人が決める
- [ ] 4.2 `README.md` と `README.ja.md`、`docs/` にエラーの形の記述があれば両方を直す
- [ ] 4.3 `record.md` を計画 §8 の書式で書く

## 5. 承認と取り込み（人が判断する）

- [ ] 5.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 5.2 マージの前に、同じ PR の中で `npx openspec archive family-error-contract --yes` を実行する
- [ ] 5.3 archive の後、正本 `openspec/specs/common-errors/spec.md` の先頭に front matter（`spec_id: READER`・`kind: common`・`introduced_by: family-error-contract`）と Purpose（50 文字以上）を書き足す（OpenSpec 1.14.1 は差分の front matter を写さない）。`ls openspec/changes` が `archive` だけであることを確かめる
- [ ] 5.4 `npx openspec validate --all && npx spec-ids check` が通る
