# Design

## 分類

`src/services/url-fetcher.ts` の `fetchPdfFromUrlUnlimited` で、`fetch(...)` と `response.arrayBuffer()` を `try` で包み、投げられた例外を次の順で分けます。`PdfReaderError` はそのまま投げ直します。

| 条件 | `code` | `retryable` | `next_actions` |
| --- | --- | --- | --- |
| 例外の名前が `TimeoutError`（`AbortSignal.timeout` が中断した） | `SOURCE_TIMEOUT` | `true` | `retry_later` |
| `cause.code` が `UND_ERR_CONNECT_TIMEOUT`・`UND_ERR_HEADERS_TIMEOUT`・`UND_ERR_BODY_TIMEOUT`・`ETIMEDOUT` | `SOURCE_TIMEOUT` | `true` | `retry_later` |
| `cause.code` が TLS の失敗（`CERT_`・`ERR_TLS_`・`ERR_SSL_` で始まる、または `DEPTH_ZERO_SELF_SIGNED_CERT`・`SELF_SIGNED_CERT_IN_CHAIN`・`UNABLE_TO_VERIFY_LEAF_SIGNATURE`・`UNABLE_TO_GET_ISSUER_CERT`・`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`） | `SOURCE_API_ERROR` | `false` | `verify_url` |
| 上のどれでもない `TypeError`（`fetch failed`）。`ECONNREFUSED`・`ENOTFOUND`・`EAI_AGAIN`・`ECONNRESET`・`UND_ERR_SOCKET` など | `SOURCE_UNAVAILABLE` | `true` | `verify_url`・`retry_later` |
| それ以外 | 分類しない（`handleStructuredError` に任せる） | | |

TLS の失敗に入る状況は、証明書の期限切れ（`CERT_HAS_EXPIRED`）・名前の不一致（`ERR_TLS_CERT_ALTNAME_INVALID`）・中間証明書の欠落（`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`）・信頼されていない CA や自己署名（`DEPTH_ZERO_SELF_SIGNED_CERT`）・TLS の版や暗号スイートの不一致（`ERR_SSL_*`）・この端末の日時のずれ（`CERT_NOT_YET_VALID` など）です。最後のものだけは原因が取得する側にあり、コードからは期限切れと区別できません。`hint` にその可能性を書き、`detail.cause` に `cause.code` を残します。どれも同じ URL を時間をおいて再試行するだけでは直らないので `retryable: false` です。

`retryable` は `RETRYABLE` の表から引くので、ここでは選びません（SPEC-READER-COMMON-ERRORS-004）。

## ライブラリの制約と仕様の制約

- ライブラリ（Node の `fetch`）の制約: 失敗の理由は `error.cause.code` にしか入らず、文は `fetch failed` で一定です。時間切れは `DOMException` で、名前が `TimeoutError` です。この形は Node 18 以降で変わっていません。
- 仕様の制約: ISO 32000 はこの変更に関わりません。根拠は family の規約（`docs/specs/06` §2.3）だけです。

## `error-handler.ts` の文の照合は残す

`inferFamilyCodeFromMessage` のネットワークの語の照合は残します。`url-fetcher.ts` を通らない経路で同じ文の例外が来たときの補助で、`url-fetcher.ts` で分類したものはそこへ届きません。
