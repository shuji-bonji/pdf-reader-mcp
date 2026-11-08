# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（2026-11-08 に A 案）。ブランチは `fix/list-item-extent`

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/e2e/25-nested-lists.test.ts` に 004 の 4 件を足す。フィクスチャ `nested-list-across-pages.pdf`（入れ子の項目が 2 ページ目に続く）を `tests/fixtures/create-e2e-fixtures.ts` に足す
- [x] 1.2 変更前の `src/` で落ちることを確かめる（4 件のうち 3 件が落ちる。「入れ子の L の範囲は下位項目を含む」は変わらない振る舞いなので通る）

## 2. 実装

- [x] 2.1 `src/services/struct-tree-service.ts` の `pagesOf`・`measureText` が、`LI` では入れ子の `L` を除いた内容を見るようにする
- [x] 2.2 ツールの説明と README（英語・日本語）
- [x] 2.3 CI の一覧（check:engines・lint・format・typecheck・build・check:public-types・test:fixtures・test・test:e2e・`openspec validate --all`・`spec-ids check`）が Node 22 と Node 20 で終了コード 0

## 3. 確認

- [x] 3.1 変更前後の `dist` で、pdf-writer-mcp 0.26.0 の入れ子のリストを読み比べる（record に書く）
- [x] 3.2 `tools/list` の差を確かめる

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 マージの前に、同じ PR の中で `npx openspec archive list-item-extent --yes` を実行する
- [ ] 4.3 `npx openspec validate --all && npx spec-ids check` が通る
