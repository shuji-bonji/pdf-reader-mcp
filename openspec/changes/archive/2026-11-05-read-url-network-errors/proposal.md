---
approved: 2026-11-05
pr: 47
implementation: required
targets: [common-errors]
---

# Proposal

## Why

`read_url` でネットワークの失敗（接続を拒まれた・ホスト名を引けない・時間切れ）が起きると、0.19.0 は `SOURCE_UNAVAILABLE`・`SOURCE_TIMEOUT` ではなく `INTERNAL_ERROR`（この server の故障）を返します（#46）。`retryable` は `false` になり、`hint` と `next_actions` が付きません。PDF family の規約（pdf-agent-stack `docs/specs/06` §2.3）では、`INTERNAL_ERROR` はサーバーの故障だけに使い、外部からの取得の失敗は `SOURCE_*` で返します。

2026-11-05 に 0.19.0 のビルドで測った応答:

| 入力 | 応答 |
| --- | --- |
| `http://127.0.0.1:9/x.pdf`（接続を拒まれる） | `{"error":"fetch failed","code":"INTERNAL_ERROR","retryable":false,"detail":{"cause":"TypeError"}}` |
| `http://no-such-host.invalid/x.pdf`（名前を引けない） | 同上 |

原因は、`src/utils/error-handler.ts` の `inferFamilyCodeFromMessage` が例外の**文**だけを見ていることです。Node の `fetch` が投げる例外の文には、分類に使う語が入っていません。

| 失敗 | 例外の名前 | 文 | 理由のある場所 |
| --- | --- | --- | --- |
| 接続を拒まれた・名前を引けない・TLS の失敗 | `TypeError` | `fetch failed` | `error.cause.code`（`ECONNREFUSED`・`ENOTFOUND`・`DEPTH_ZERO_SELF_SIGNED_CERT` など） |
| 時間切れ（`AbortSignal.timeout`） | `TimeoutError` | `The operation was aborted due to timeout` | 例外の名前 |

既存の単体テストは `new Error('connect ECONNREFUSED 127.0.0.1:80')` のような作った文で確かめていたので通っていました。#40 と同じ形の不具合です。

## What Changes

- `src/services/url-fetcher.ts` で `fetch` の呼び出しと本文の受信を包み、ネットワークの失敗を、例外の名前と `cause.code` で分けた `PdfReaderError`（`familyCode` 付き）にして投げる。分け方は design.md の表のとおり。
- TLS の失敗（証明書を検証できない・期限切れ・名前が合わない・ハンドシェイクの失敗）は、再試行しても直らないので `SOURCE_API_ERROR`（`retryable: false`）にする（2026-11-05 本人の判断）。
- 元の文と `cause.code` は `detail.cause` に残す（例: `fetch failed (ECONNREFUSED)`）。

### 変わる振る舞い

- `read_url` で接続を拒まれた・名前を引けない・接続が切れたとき、`code` が `INTERNAL_ERROR` から `SOURCE_UNAVAILABLE`（`retryable: true`）に変わり、`hint` と `next_actions`（`verify_url`・`retry_later`）が付く。
- 時間切れのとき、`code` が `INTERNAL_ERROR` から `SOURCE_TIMEOUT`（`retryable: true`）に変わり、`next_actions`（`retry_later`）が付く。
- TLS の失敗のとき、`code` が `INTERNAL_ERROR` から `SOURCE_API_ERROR`（`retryable: false`）に変わり、`next_actions`（`verify_url`）が付く。

### 変わらない振る舞い

- 成功したときの出力。HTTP が成功以外を返したときの `SOURCE_API_ERROR`。URL の誤り・`http`/`https` 以外の `INVALID_ARGUMENT`。50 MB を超えたときの `FILE_TOO_LARGE`。
- `retryable` の表（`RETRYABLE`）と `code` の名前。新しいコードは足さない。
- 時間切れの長さ（30 秒）と同時に取得する数の上限。

### 対象外

- 読み取り権限の無いファイル（`EACCES`）を `INTERNAL_ERROR` で返していること（別の Issue で扱う）。
- pdf-agent-stack の S6 に `read_url` のネットワークの失敗を足すこと（pdf-agent-stack#48 で決める）。

## Capabilities

- `common-errors`（ADDED: 007）

## 人が判断すること

- TLS の失敗を `SOURCE_API_ERROR` にすること（2026-11-05 に決めた）。
- 版。4 件の変更をまとめて 0.20.0（minor）にすることを提案します（`get_page_count` に引数が増え、`get_metadata` と `inspect_tags`・`extract_tables` の応答に項目が増えるため）。
