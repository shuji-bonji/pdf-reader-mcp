# Tasks

## 1. 提案

- [x] 1.1 proposal / 差分 spec（`tools-list` の 001・002）/ design / tasks を書く。`approved` と `pr` は空のまま

## 2. 受入テスト（先に落ちることを確かめる）

- [ ] 2.1 `tests/tier1/tools-list.test.ts` に、`it('SPEC-READER-TOOLS-LIST-001 tools/list の名前の集合が 18 ツールと一致する')`・`it('SPEC-READER-TOOLS-LIST-001 削除した 2 ツールは tools/list に無い')`・`it('SPEC-READER-TOOLS-LIST-002 validate_ で始まるツールが無い')` を書く
- [ ] 2.2 削除の前に、3 件とも落ちることを確かめる

## 3. 削除

- [ ] 3.1 登録とツールのファイルを消す（`src/tools/index.ts`・`src/tools/tier3/validate-*.ts`）
- [ ] 3.2 2 ツールだけが使っていた部品を消す（design.md の表）。消す前に呼び出し元を grep で確かめる
- [ ] 3.3 テストを整理する（`06` を消す、`08`・`09`・`constants.ts`・`validation-service.test.ts`・`verify-tier3.mjs` から 2 ツールの分を除く）
- [ ] 3.4 `scripts/golden.mjs` の呼び出しの一覧と自己検査（t3）を直し、`t3` が通ることを確かめる
- [ ] 3.5 `npm run test:fixtures` → `npm test` → `npm run lint` → `npm run format` → `npm run typecheck` → `npm run build` → `npm run check:public-types` がすべて終了コード 0
- [ ] 3.6 残る 18 ツールの出力が変わらないことを、`scripts/golden.mjs` で変更の前後を採って `diff` で確かめる（json と markdown の両方）

## 4. 文書と記録

- [ ] 4.1 README / README.ja のツール一覧、CLAUDE.md、`docs/TASKS.md` B-1、`src/index.ts` の説明を直す
- [ ] 4.2 `CHANGELOG.md`（英語）の Unreleased に Removed と移行先を書く。版は人が決める
- [ ] 4.3 `record.md` を計画 §8 の書式で書く

## 5. 承認と取り込み（人が判断する）

- [ ] 5.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [ ] 5.2 `npx openspec archive remove-validate-tools --yes` で `openspec/specs/tools-list/spec.md` を作る（**マージの前に**。実装 PR は `openspec/changes/<slug>/` の追加を通さないため）
- [ ] 5.3 archive が作った正本の先頭に front matter（`spec_id: READER`・`kind: common`・`introduced_by: remove-validate-tools`）を書き足す。OpenSpec 1.14.1 は新しい capability の正本を作るとき差分の front matter を写さず、そのままだと `spec-ids check` が「front matter がありません」で落ちる（2026-10-15 に使い捨てのブランチで確認）
- [ ] 5.4 `npx openspec validate --all && npx spec-ids check` と `pr-scope` が通る
