# record: nested-lists-as-elements

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-reader-mcp#52（pdf-writer-mcp 0.25.0 の入れ子のリストを読むと、入れ子の項目が親の `text` に畳まれた） |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-reader-mcp 0.21.0 → 0.22.0（提案。人が決める）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-06 |
| 仕様の確認 | pdf-spec-mcp で ISO 32000-1 §14.8.4.3.3（Table 336 の LBody: "perhaps including nested lists"）と ISO 32000-2 §14.8.4.8.2 の NOTE（"Lists can occur within the content of an LBody"）を引いた。親の `L` の直接の子に置く条文（§14.8.4.8.2 の shall）は #52 の本文の引用による |
| 人が判断した箇所 | 🔴 未判断: 「同じ depth の付き方」の読み方（proposal の「人が判断すること」）。版 |
| テスト | `tests/e2e/25-nested-lists.test.ts` の 4 件とフィクスチャ `nested-lists.pdf`（`tests/fixtures/create-e2e-fixtures.ts`）。変更前の `src/` では 2 件が落ちた（LBody の中の形・Markdown の字下げ）。通った 2 件は、変わらない振る舞い（H.8.3 の形は前から辿れていた・入れ子の無いリスト） |
| A/B | 変更前後で、`tests/fixtures/` の全 22 検体に `extract_structured_text`（`include_bbox` なし・あり）を当て、JSON と Markdown を比べた。差は `nested-lists.pdf` の 2 件だけ（44 件中）。計器が差を拾えることは、この 2 件で確かめた |
| tools/list の比較 | `main`（`8220778`）と変更後の `dist` を stdio で起動して比べた。差は `extract_structured_text` の `description` だけ（入れ子のリストの出し方の 1 項目） |
| 読み戻し | pdf-writer-mcp（`fix/winansi-input-and-glyph-detail` の `dist`）で #52 の再現の Markdown に番号付きの入れ子を足して描き、読んだ。`LI "Parent one"`・`L`（depth 3）・`LI "Nested one"`・`LI "Nested two"`（depth 4）・`LI "Parent two"`、番号付きは `label` が `1.`・`2.` で、#52 の「期待する出力（案）」と同じ。`main` では `"Parent one • Nested one • Nested two"`・`"First 1. Sub a 2. Sub b"` だった |
| ゲート | check:engines・lint・format・typecheck・build・check:public-types・test:fixtures・test（529 件通過・2 件 skip）・test:e2e（343 件通過・2 件 skip）・`openspec validate --all`・`spec-ids check` が終了コード 0。test と test:e2e は Node 22.23.4 と Node 20.20.2 の両方 |
| 仕様と実装のずれ | 0 件 |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
| 未対応 | `LI` の `pages`・`boxes` は入れ子の項目を含む範囲のまま（proposal の「変わらない振る舞い」） |
