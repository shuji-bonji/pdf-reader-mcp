# record: tags-unreadable-when-key-not-derived

計画 §8 の書式。時刻は JST。

| 項目 | 記録 |
| --- | --- |
| 版 | OpenSpec 1.14.1 / spec-ids（`npx spec-ids`）/ pdf-reader-mcp 0.19.0 → 0.20.0 の予定（版は人が決める）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-05 |
| PR の切り方 | 4 件の変更を 1 本（計画 §6.3）。ブランチ `fix/reader-0.20.0`。提案の commit（15:55）の前に、人がチャットで方針を選んだ（15:50）。`approved`・`pr` の記入と archive は PR を出した後に行う |
| きっかけ | #39（pdf-agent-stack#47 の試用 E2・E1、所見 F-01） |
| 仕様を書いた時間 | 約 10 分（按分。3 capability の初版を起こした） |
| 実装した時間 | 約 35 分（15:58〜16:34。検体のバイト列化・e2e と tier1 の受入テスト・3 つの入口・型・markdown・説明文） |
| 人が判断した箇所 | `extract_structured_text` を、成功応答ではなく `read_text` と同じ `ENCRYPTED_PDF` のエラー応答にする（推奨案どおり） |
| 仕様と実装のずれ | 0 件 |
| エージェントが仕様に無い振る舞いを実装した件数 | 1 件。`extract_tables` の markdown で「No tables were extracted」も書かないようにした（Requirement は JSON の `null` と note だけを書いている） |
| 実装後に仕様を読み返した回数 | 0 回 |
| テスト | `tests/e2e/20-tags-unreadable.test.ts`（7 件）・`tests/tier1/tags-unreadable.test.ts`（1 件）。変更前の `src/` で 5 件が落ちた（通った 3 件は、暗号化されていない文書の振る舞いと検体の前提を固定するもの） |
| 維持の手間 | 検体のバイト列 1 つ（`tests/e2e/locked-specimens.ts`） |

## 分かったこと

1. **鍵を導けない文書の扱いが、同じサーバーの中で 2 通りだった。** 5 ツールは note を付けて「読めなかった」と言い、3 ツールは「タグが無い」と言っていた。3 ツールとも `struct-tree-service.ts` の入口で `lockedOut(scope)` を構造木の走査には渡していたが、その前の `/MarkInfo` の読み取りには使っていなかった。
2. **catalog が壊れていて読めない文書も同じ形で「タグが無い」になる**（`getCatalog()` の失敗を `null` に畳んでいる）。この変更の対象外として proposal に書いた。
