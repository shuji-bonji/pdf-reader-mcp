# record: read-url-network-errors

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの、pdf-reader-mcp の記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| 版 | OpenSpec 1.14.1 / spec-ids（`npx spec-ids`）/ pdf-reader-mcp 0.19.0 → 0.20.0 の予定（版は人が決める）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-05 |
| PR の切り方 | 4 件の変更を 1 本（計画 §6.3）。ブランチ `fix/reader-0.20.0`。提案の commit（15:55）の前に、人がチャットで方針を選んだ（15:50）。`approved`・`pr` の記入と archive は PR を出した後に行う |
| きっかけ | #46（0.19.0 の公開後の確認で見つけた） |
| 仕様を書いた時間 | 約 15 分（15:40〜15:55。4 件の提案をまとめて書いた時間の按分。0.19.0 のビルドでの再現を含む） |
| 実装した時間 | 約 10 分（15:55〜15:58 の実装と、TLS の検体づくり・実測） |
| 人が判断した箇所 | (1) TLS の失敗を `SOURCE_API_ERROR`（`retryable: false`）にする（推奨案は `SOURCE_UNAVAILABLE` だった）。(2) TLS の失敗に入る状況の範囲を人が質問で確かめ、端末の日時のずれも含めると決めた |
| 仕様と実装のずれ | 1 件。提案の後の実測で、Issue の再現手順のポート 9 は Fetch Standard の bad port で、接続を拒まれたのではなかった。`INVALID_ARGUMENT` に分ける Scenario を差分仕様に足した（実装の前） |
| エージェントが仕様に無い振る舞いを実装した件数 | 0 件 |
| 実装後に仕様を読み返した回数 | 1 回（bad port を足したとき） |
| テスト | `tests/e2e/19-read-url-network-errors.test.ts`（7 件）。変更前の `src/` で 7 件とも落ちた。外の網には触れない（127.0.0.1 と `.invalid`） |
| 維持の手間 | 証明書の検体 4 つ（2126 年まで有効。期限切れの検体は 2021 年に切れたもの） |

## 分かったこと

1. **ポート 9 は「接続を拒まれた」ではなかった。** Fetch Standard の bad port で、`fetch` は接続を試みずに断る（`cause.message` が `bad port`、`cause.code` は無い）。Issue の再現手順の値をそのまま受入テストに使っていたら、`ECONNREFUSED` の経路は一度も通らなかった。
2. **CA を信頼していないと、名前違いの証明書は「名前が違う」まで進まない。** `UNABLE_TO_VERIFY_LEAF_SIGNATURE` で止まる。期限切れは CA を信頼していなくても `CERT_HAS_EXPIRED` が先に出る。名前違いの Scenario は `NODE_EXTRA_CA_CERTS` を付けた子プロセスで確かめた。
