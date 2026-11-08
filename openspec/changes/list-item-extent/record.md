# record: list-item-extent

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | pdf-reader-mcp#54（#52 の公開版の確認で、2026-11-06 に起票） |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-reader-mcp 0.22.0 → 0.23.0（案）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-08 |
| 仕様の確認 | #54 で pdf-spec-mcp から引いた ISO 32000-2 §14.8.4.8.2 NOTE と §14.8.5.4.5 をそのまま使った（この変更で新たには引いていない） |
| 人が判断した箇所 | A 案（2026-11-08）。🔴 未判断: 版（0.23.0 の案。`pages` 引数での絞り込みの結果が変わるため minor） |
| 作業中に広がった範囲 | `pages` 引数での絞り込みも `LI` の `pages` を見るので、入れ子の項目だけがあるページを指定したときに親の `LI` が返らなくなる。proposal の「変わる振る舞い」に書いた |
| A/B | pdf-writer-mcp（0.26.0 と同じリストの出力）で `- Parent one` の下に 2 項目を持つタグ付き PDF を作り、変更前後の `dist` を stdio で起動して `extract_structured_text`（`include_bbox: true`）を比べた。差は `Parent one` の `LI` の箱だけ（y 705.3〜751.4 → 741.2〜751.4。高さ 10.2 は他の 1 行の項目と同じ）。`pages`・`text`・他の要素は同じ |
| tools/list の比較 | 18 ツールのうち `extract_structured_text` の `description` だけが違う（入れ子の項目の範囲の 2 行）。`inputSchema` は同じ |
| ゲート | check:engines・lint・format・typecheck・build・check:public-types・test:fixtures・test・test:e2e・`openspec validate --all`・`spec-ids check` が終了コード 0。test と test:e2e は Node 22.23.4 と Node 20.20.2 の両方で、test 533 件通過・2 件 skip、test:e2e 347 件通過・2 件 skip。性能テストが書き換えた `tests/e2e/baseline.json` は戻した |
| テスト | `tests/e2e/25-nested-lists.test.ts` の 004 の 4 件。変更前の `src/` では 3 件が落ちた。通った 1 件は変わらない振る舞い（入れ子の `L` の範囲は下位項目を含む）。フィクスチャ `nested-list-across-pages.pdf` を足した |
| 仕様と実装のずれ | 0 件 |
| 維持の手間 | 仕様だけを変えた変更: 0 件。003 の proposal の「変わらない振る舞い」（`LI` の `pages`・`boxes` は入れ子を含むまま）を、この変更で覆した |
