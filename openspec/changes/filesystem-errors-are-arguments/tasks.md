# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（#49 の本文、2026-11-06）。ブランチは `fix/reader-unreadable-inputs`（#49・#50 の 2 件）

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/e2e/24-unreadable-inputs.test.ts` に実物（`chmod 000`）のテストを、`tests/tier1/common-errors.test.ts` に単体のテストを足す。名前を「SPEC-READER-COMMON-ERRORS-008 <Scenario 名>」で始める
- [x] 1.2 変更前の `src/` で落ちることを確かめる

## 2. 実装

- [x] 2.1 `src/utils/error-handler.ts`: Node の例外の `code` で、ファイルシステムのエラーを `INVALID_ARGUMENT` にする
- [x] 2.2 `src/errors.ts`: `detail` に `reason`・`path` を足す
- [x] 2.3 CI の一覧（check:engines・lint・format・typecheck・build・check:public-types・test:fixtures・test・test:e2e、Node 22 と 20）が終了コード 0

## 3. 確認

- [x] 3.1 `tools/list` の差が無いことを確かめる

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 マージの前に、同じ PR の中で `npx openspec archive filesystem-errors-are-arguments --yes` を実行する
- [ ] 4.3 `npx openspec validate --all && npx spec-ids check` が通る
