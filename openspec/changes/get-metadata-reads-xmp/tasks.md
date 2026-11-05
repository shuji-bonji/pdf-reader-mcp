# Tasks

## 0. 前提

- [x] 0.1 人が proposal.md を承認している（4 件の変更を 1 本の PR で進める。ブランチは `fix/reader-0.20.0`。2026-11-05 15:50 にチャットで方針を選んだ。`approved` は人が書く）

## 1. 受入テスト（先に落ちることを確かめる）

- [x] 1.1 検体はテストの中でバイト列から組み立てる（`tests/e2e/metadata-specimens.ts`）: `/Info` 無しの PDF 2.0（XMP に `dc:title` の `rdf:Alt`・`dc:creator` の `rdf:Seq`・属性の形の `xmp:CreatorTool`）、`/Info` と XMP の値が食い違う PDF 2.0 と PDF 1.7、同じ時刻を別の書き方で持つ文書
- [x] 1.2 `tests/e2e/22-get-metadata-xmp.test.ts` を足し、各 Scenario を 1 件以上のテストにする。名前は「SPEC-READER-GET-METADATA-<3 桁> <Scenario 名>」
- [x] 1.3 XMP の値の取り出しと日付の比較は 1.2 の e2e で確かめた（tier1 には足していない）
- [x] 1.4 変更前の `src/` で 1.2 が落ちることを確かめる

## 2. 実装

- [x] 2.1 `src/services/xmp-service.ts`: 8 項目を取り出す関数（名前空間は URI で引く。`rdf:Alt`・`rdf:Seq`・属性の形・文字参照）
- [x] 2.2 `src/services/pdfjs-service.ts` の `getMetadataFromDoc`: XMP を読み、版で優先を決め、`metadataSources`・`metadataConflicts`・`xmpMetadata` を組み立てる。`summarize` の文書情報も同じ関数を通る
- [x] 2.3 `src/types.ts`・`src/utils/formatter.ts`（出どころの列と食い違いの節）・`get_metadata` のツール説明

## 3. 確認

- [x] 3.1 `npm run check:engines`・`npm run lint`・`npm run format`・`npm run typecheck`・`npm run build`・`npm run check:public-types`・`npm run test:fixtures`・`npm test`・`npm run test:e2e` が終了コード 0
- [x] 3.2 `npx openspec validate --all && npx spec-ids check` が通る

## 4. 承認と取り込み（人が判断する）

- [ ] 4.1 人が `proposal.md` の front matter に `approved` と `pr` を書く
- [ ] 4.2 マージの前に `npx openspec archive get-metadata-reads-xmp --yes` を実行する
