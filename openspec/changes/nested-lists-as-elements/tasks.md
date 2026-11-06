# Tasks

## 0. 前提

- [x] 0.1 方針は人が決めている（#52 の本文、2026-11-06。決まっていなかった点は proposal の「人が判断すること」）。ブランチは `fix/nested-lists-as-elements`

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 フィクスチャ `nested-lists.pdf`（LBody の中の形と H.8.3 の形）を足し、`tests/e2e/25-nested-lists.test.ts` に受入テストを足す。名前を「SPEC-READER-EXTRACT-STRUCTURED-TEXT-003 <Scenario 名>」で始める
- [x] 1.2 変更前の `src/` で落ちることを確かめる

## 2. 実装

- [x] 2.1 `src/services/struct-tree-service.ts` の `flatten`: `LI` の文字から入れ子の `L` を除き、入れ子の `L` を `LI` の直後に出す
- [x] 2.2 ツールの説明に入れ子のリストの出し方を足す
- [x] 2.3 CI の一覧（check:engines・lint・format・typecheck・build・check:public-types・test:fixtures・test・test:e2e、Node 22 と 20）が終了コード 0

## 3. 確認

- [x] 3.1 `tools/list` の差が `extract_structured_text` の説明文だけであることを確かめる
- [x] 3.2 全フィクスチャで `extract_structured_text` を変更前後で比べ（A/B）、差が `nested-lists.pdf` だけであることを確かめる
- [x] 3.3 pdf-writer-mcp の出力（#52 の再現の Markdown）を読み、入れ子の項目が要素として出ることを確かめる

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 4.2 マージの前に、同じ PR の中で `npx openspec archive nested-lists-as-elements --yes` を実行する
- [ ] 4.3 `npx openspec validate --all && npx spec-ids check` が通る
