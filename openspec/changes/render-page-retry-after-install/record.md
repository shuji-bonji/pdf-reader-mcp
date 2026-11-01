# record: render-page-retry-after-install

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）の記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-reader-mcp 0.17.0 → 次の版（人が決める。patch の 0.17.1 を提案）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-01 |
| きっかけ | 2026-10-31 の「書いた直後の読み取りの鮮度の確認」（pdf-agent-stack-docs `reviews/2026-10-31-state-freshness-report.md`）で見つけ、Issue #34 にした。本人の指示（2026-11-01「全ての Issue を消化してほしい」）で着手 |
| 仕様を書いた時間 | 約 5 分（proposal / 差分 spec / design / tasks）。`render-page` は正本が無いので、この変更が触る振る舞い（部品の読み込み）だけで capability を作った |
| 人が判断した箇所 | (1) 版。(2) `approved`・`pr` の記入と archive |
| 仕様と実装のずれ | 0 件。受入テストは、旧来の振る舞い（失敗も覚える）のまま `createPdfiumLoader` を切り出した段階で 3 件とも落ち（2 件目は同時の 2 回の呼び出しで読み込みが 2 回走るため）、修正の後に 3 件とも通った |
| エージェントが仕様に無い振る舞いを実装した件数 | 0 件。`init()` の失敗も覚えないことを、ID の無いテスト 1 件で固定した（001 の「読み込み」に初期化も含むと読んでいる） |
| 実装後に仕様を読み返した回数 | 0 回 |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |
| 出力の A/B | 取っていない。変えたのは `render_page` の部品の読み込みだけで、他の 17 ツールは部品を読まない。`render_page` の描画の結果は e2e の 13・16 が測っていて、通った |
| 起動したままの確認 | ビルドした `dist` を stdio で起動し、`node_modules/@hyzyla/pdfium` を外した状態で `render_page` → 起動したまま戻す → `render_page` を 2 回。応答は `isError: true`（案内の文）→ text と image（`Rendered 1 page(s)`）→ 同じ。Node は解決に失敗した `import()` を次の呼び出しで解決し直すことも、これで確かめた |
| テストの数 | `npm test` 456 → 459 件（+3）。`test:e2e` 285 件。check:engines・lint・format・typecheck・build・check:public-types・test:fixtures はすべて終了コード 0 |

## 分かったこと

1. **「失敗を覚える」は、利用者のデータを覚えるのと別の形の古さを作る。** 鮮度の確認の依頼（s1000d 側の案）は「利用者のデータから作った結果を指紋で確かめる」だったが、この件で覚えていたのは実行環境（`node_modules`）から作った失敗だった。pdf-verify-mcp#24（veraPDF の探索）と pdf-spec-mcp#29（索引作りの失敗）も同じ形。
2. **エラーの案内の文は、それ自体が振る舞いの約束になる。** 「入れて、もう一度呼んで」と書いた時点で、同じプロセスへの再試行で結果が変わる作りでなければならなかった。001 の本文にこの理由を書いた。
