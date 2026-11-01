# Tasks

## 1. 提案

- [x] 1.1 proposal / 差分 spec（`render-page` の 001）/ design / tasks を書く。`approved` と `pr` は空のまま

## 2. 受入テスト（先に落ちることを確かめる）

- [x] 2.1 `tests/tier1/page-renderer-loader.test.ts` に `it('SPEC-READER-RENDER-PAGE-001 読み込みに失敗した後で部品が入ると、次の呼び出しで読み込む')` と `it('SPEC-READER-RENDER-PAGE-001 読み込みに成功した部品は 2 回目に読み込み直さない')` を書く
- [x] 2.2 修正の前に、1 件目が落ちることを確かめる

## 3. 実装

- [x] 3.1 `createPdfiumLoader(importModule)` を切り出し、成功だけを覚える
- [x] 3.2 `npm run lint` → `npm run format` → `npm run typecheck` → `npm run build` → `npm run check:public-types` → `npm run test:fixtures` → `npm test` → `npm run test:e2e` がすべて終了コード 0
- [x] 3.3 ビルドした `dist` を stdio で起動し、部品を外した状態で `render_page` → 起動したまま部品を戻す → `render_page` が描画することを確かめる（record.md に書く）

## 4. 文書と記録

- [x] 4.1 `CHANGELOG.md`（英語）の Unreleased に Fixed を書く。版は人が決める
- [x] 4.2 `record.md` を計画 §8 の書式で書く

## 5. 承認と取り込み（人が判断する）

- [x] 5.1 人が `proposal.md` の front matter に `approved: YYYY-MM-DD` と `pr: N` を書く
- [x] 5.2 `npx openspec archive render-page-retry-after-install --yes` で `openspec/specs/render-page/spec.md` を作る（マージの前に）
- [x] 5.3 archive が作った正本の先頭に front matter（`spec_id: READER`・`kind: tool`・`introduced_by: render-page-retry-after-install`）を書き足す
- [x] 5.4 `npx openspec validate --all && npx spec-ids check` と `pr-scope` が通る
