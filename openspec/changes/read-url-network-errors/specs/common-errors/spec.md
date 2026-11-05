## ADDED Requirements

### Requirement: SPEC-READER-COMMON-ERRORS-007 外部からの取得の失敗は例外の名前と理由のコードで分ける

`read_url` の取得がネットワークの段階で失敗したときは、例外の文ではなく、例外の名前と、その例外が持つ理由のコードで `code` を決める（SHALL）。時間切れは `SOURCE_TIMEOUT`、接続を拒まれた・ホスト名を引けない・接続が切れたなど相手に届かなかった失敗は `SOURCE_UNAVAILABLE`、TLS の失敗（証明書を検証できない・期限切れ・名前が合わない・ハンドシェイクの失敗）は `SOURCE_API_ERROR`、Fetch Standard が接続を断るポート（bad port）を指す URL は `INVALID_ARGUMENT` にし、どれも `INTERNAL_ERROR` で返さない（SHALL）。元の文と理由のコードは `detail.cause` に残す（SHALL）。受入テストは、作った文ではなく実際の取得の失敗で確かめる。

#### Scenario: 接続を拒まれると SOURCE_UNAVAILABLE

- **WHEN** 使われていない 127.0.0.1 のポートを指す URL を `read_url` に渡す
- **THEN** `code` は `SOURCE_UNAVAILABLE`、`retryable` は `true`、`detail.cause` は `ECONNREFUSED` を含む

#### Scenario: 名前を引けないと SOURCE_UNAVAILABLE

- **WHEN** 存在しないホスト名（`.invalid`）の URL を `read_url` に渡す
- **THEN** `code` は `SOURCE_UNAVAILABLE`、`retryable` は `true`

#### Scenario: 応答が来ないまま時間切れになると SOURCE_TIMEOUT

- **WHEN** 接続を受けて応答を返さない 127.0.0.1 のサーバーへ、短い時間切れで取得する
- **THEN** `code` は `SOURCE_TIMEOUT`、`retryable` は `true`

#### Scenario: 証明書を検証できないと SOURCE_API_ERROR

- **WHEN** 自己署名の証明書を出す 127.0.0.1 の HTTPS サーバーの URL を `read_url` に渡す
- **THEN** `code` は `SOURCE_API_ERROR`、`retryable` は `false`

#### Scenario: 証明書の期限が切れていると SOURCE_API_ERROR

- **WHEN** 期限の切れた証明書を出す 127.0.0.1 の HTTPS サーバーの URL を `read_url` に渡す
- **THEN** `code` は `SOURCE_API_ERROR`、`detail.cause` は `CERT_HAS_EXPIRED` を含む

#### Scenario: 証明書の名前が合わないと SOURCE_API_ERROR

- **WHEN** 別の名前で発行した証明書を出す 127.0.0.1 の HTTPS サーバーの URL を `read_url` に渡す
- **THEN** `code` は `SOURCE_API_ERROR`

#### Scenario: fetch が断るポートは INVALID_ARGUMENT

- **WHEN** Fetch Standard が接続を断るポート（9）を指す URL を `read_url` に渡す
- **THEN** `code` は `INVALID_ARGUMENT`、`retryable` は `true`
