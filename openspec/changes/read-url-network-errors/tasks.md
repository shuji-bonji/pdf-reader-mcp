# Tasks

## 0. 前提

- [ ] 0.1 人が proposal.md を承認している（4 件の変更を 1 本の PR で進める。ブランチは `fix/reader-0.20.0`）

## 1. 受入テスト（先に落ちることを確かめる）

- [ ] 1.1 `tests/e2e/18-common-errors.test.ts` に SPEC-READER-COMMON-ERRORS-007 の 4 Scenario を足す。名前は「SPEC-READER-COMMON-ERRORS-007 <Scenario 名>」。`fetch` は差し替えず、127.0.0.1 に立てたサーバー（応答を返さない・自己署名の HTTPS）と使われていないポートで確かめる。外の網には触れない（`.invalid` は名前解決の段階で失敗する）
- [ ] 1.2 時間切れの Scenario は 30 秒を待たないよう、`fetchPdfFromUrlUnlimited` に時間切れの長さを渡せる引数（テスト用）を足して短くする
- [ ] 1.3 変更前の `src/` で 1.1 が落ちることを確かめる

## 2. 実装

- [ ] 2.1 `src/services/url-fetcher.ts`: design.md の表のとおり分類して `PdfReaderError` を投げる
- [ ] 2.2 `tests/tier1/errors.test.ts` の作った文のテストは残す（文の照合の補助を固定している）

## 3. 確認

- [ ] 3.1 `npm run check:engines`・`npm run lint`・`npm run format`・`npm run typecheck`・`npm run build`・`npm run check:public-types`・`npm run test:fixtures`・`npm test`・`npm run test:e2e` が終了コード 0
- [ ] 3.2 `npx openspec validate --all && npx spec-ids check` が通る

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved` と `pr` を書く
- [ ] 4.2 マージの前に `npx openspec archive read-url-network-errors --yes` を実行する
