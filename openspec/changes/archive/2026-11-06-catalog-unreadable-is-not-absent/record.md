# record: catalog-unreadable-is-not-absent

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| きっかけ | 2026-11 の試用（pdf-agent-stack#47）の振り分けで、Issue にしていなかった候補（#50） |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-reader-mcp 0.20.1 → 0.21.0（提案。人が決める）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-06 |
| PR の切り方 | reader の 2 件（#49・#50）を 1 本のブランチ `fix/reader-unreadable-inputs` にまとめた。提案は人の決定（各 Issue の本文、2026-11-06）の後に書き、チャットでの承認を待たずに実装した。`approved`・`pr` の記入と archive は PR の後 |
| tools/list の比較 | 変更前（main の `6267f35`）と変更後の `dist` を `pdf-agent-stack/scripts/tools-list-snapshot.mjs` で比べた。18 ツールとも差 0 件 |
| ゲート | check:engines・biome check・typecheck・build・check:public-types・test:fixtures・test（526 件）・test:e2e（340 件）が Node 22 で、test と test:e2e が Node 20.20.2 でも終了コード 0。`tests/e2e/baseline.json`（性能テストが書き換える）は HEAD の内容に戻した |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
| 人が判断した箇所 | (1) 方針（#50 の本文）。ISO 32000-2 §7.7.2 は pdf-spec-mcp で確かめた。(2) `inspect_signatures` は `null` ではなく `0` と `note` にすること、`extract_structured_text` の失敗の `code` を `INVALID_PDF` にすること（提案の「人が判断すること」。未確認） |
| 仕様と実装のずれ | 0 件 |
| 実検体 | 2 つの検体（`/Root` が無いオブジェクトを指す・整数を指す）で 0.20.1 の 9 ツールを呼び、「無い」と答える 4 ツールを特定した（proposal.md の表）。残りの 5 ツールは前から読めなかったことを書いている |
| テスト | `tests/e2e/24-unreadable-inputs.test.ts` の 9 件。変更前に 6 件が落ち、読める catalog の 3 件は前から通る |
