# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（#50 の本文。2026-11-06）。ISO 32000-2 §7.7.2（Table 29。`Type` は Required で Catalog、`Pages` は Required）は pdf-spec-mcp で確かめた。ブランチは `fix/reader-unreadable-inputs`
- [x] 0.2 10 か所のうち「無い」と答えるツールを、2 つの検体で 9 ツールを呼んで確かめた（proposal.md の表）

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 `tests/e2e/24-unreadable-inputs.test.ts` に足す。検体は手で組む（`/Root` が無いオブジェクトを指す・整数を指す）。名前を「SPEC-READER-<機能>-<3 桁> <Scenario 名>」で始める
- [x] 1.2 変更前の `src/` で落ちることを確かめる

## 2. 実装

- [x] 2.1 catalog を読めたかを返す関数（`readCatalog`）を置き、4 ツールの入口で使う
- [x] 2.2 note の文（`CATALOG_UNREADABLE_NOTE`）を置く。markdown で「Tagged: No」と書かない
- [x] 2.3 CI の一覧が終了コード 0

## 3. 確認

- [x] 3.1 `tools/list` の差が無いことを確かめる

## 4. 承認と取り込み（人が判断する）

- [x] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [x] 4.2 マージの前に、同じ PR の中で `npx openspec archive catalog-unreadable-is-not-absent --yes` を実行する
- [x] 4.3 archive の後、正本 `openspec/specs/inspect-signatures/spec.md` の先頭に front matter（`spec_id: READER`・`kind: tool`・`introduced_by: catalog-unreadable-is-not-absent`）と Purpose（50 文字以上）を書き足す
- [x] 4.4 `npx openspec validate --all && npx spec-ids check` が通る
