# Tasks

## 0. 前提

- [x] 0.1 人が proposal.md を承認している（4 件の変更を 1 本の PR で進める。ブランチは `fix/reader-0.20.0`。2026-11-05 15:50 にチャットで方針を選んだ。`approved` は人が書く）

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/e2e/19-read-url-network-errors.test.ts` を足し、SPEC-READER-COMMON-ERRORS-007 の 7 Scenario を書く。名前は「SPEC-READER-COMMON-ERRORS-007 <Scenario 名>」。`fetch` は差し替えず、127.0.0.1 に立てたサーバー（応答を返さない・自己署名・期限切れ・名前違いの HTTPS。証明書は `tests/e2e/tls-specimens/`。名前違いは CA を信頼させる子プロセスで確かめる）と使われていないポートで確かめる。外の網には触れない（`.invalid` は名前解決の段階で失敗する）
- [x] 1.2 時間切れの Scenario は 30 秒を待たないよう、`fetchPdfFromUrlUnlimited` に時間切れの長さを渡せる引数（テスト用）を足して短くする
- [x] 1.3 変更前の `src/` で 1.1 が落ちることを確かめる

## 2. 実装

- [x] 2.1 `src/services/url-fetcher.ts`: design.md の表のとおり分類して `PdfReaderError` を投げる
- [x] 2.2 `tests/tier1/errors.test.ts` の作った文のテストは残す（文の照合の補助を固定している）

## 3. 確認

- [x] 3.1 `npm run check:engines`・`npm run lint`・`npm run format`・`npm run typecheck`・`npm run build`・`npm run check:public-types`・`npm run test:fixtures`・`npm test`・`npm run test:e2e` が終了コード 0
- [x] 3.2 `npx openspec validate --all && npx spec-ids check` が通る

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved` と `pr` を書く
- [ ] 4.2 マージの前に `npx openspec archive read-url-network-errors --yes` を実行する
