---
spec_id: READER
kind: common
introduced_by: family-error-contract
---
# common-errors Specification

## Purpose

18 ツールに共通する、失敗の返し方を定めます。失敗したときの応答だけを読んで、利用者（LLM・Skill・人）が次に何をすればよいかを決められるようにすることが目的です。そのために、ツール結果 `isError: true` の本文を PDF family の規約（pdf-agent-stack `docs/specs/06` §2.3）の形にそろえ、状況ごとに 1 つの `code`（houki-hub family の共通語彙と、reader 固有の `RENDERER_NOT_AVAILABLE`）を返し、`code` ごとに決めた `retryable` を必ず書きます。`hint` と `next_actions` には、reader で実際に取れる手だけを英語で書きます。reader はパスワードを受け取らないので、暗号化文書には「パスワードを渡す」ではなく「復号したファイルを渡す」と案内します。
受け側は `code` で次の手を分けます。`INVALID_ARGUMENT` は引数を直して呼び直し、`RENDERER_NOT_AVAILABLE` は描画の部品を入れて呼び直します。`INVALID_PDF` は文書についての所見なので、サーバーの故障としてではなく、読めなかった理由として利用者に伝えます。`DOC_NOT_FOUND` と `ENCRYPTED_PDF` は reader の中では解決できず、`INTERNAL_ERROR` だけがサーバーの故障です。`next_actions[].action` の値は受け側の分岐に使うので変えません。SDK がハンドラより前に拒む入力検証の失敗は、この capability の対象外です（§2.11）。

## Requirements

### Requirement: SPEC-READER-COMMON-ERRORS-001 エラー応答の本文は family の平らな形にする

18 ツールのハンドラが返す失敗は、ツール結果の `isError: true` で返し、`content` の text を JSON のオブジェクトにする（SHALL）。最上位には `error`（空でない文字列）・`code`（文字列）・`retryable`（真偽値）を必ず書き、任意で `hint`（文字列）・`next_actions`（`{ action, reason, example? }` の配列）・`detail`（オブジェクト）を書く（SHALL）。最上位にこれ以外の項目を置かない（SHALL）。根拠は pdf-agent-stack `docs/specs/06` §2.3。

#### Scenario: 存在しないパスのエラーが形どおり

- **WHEN** `get_page_count` に存在しない絶対パスを渡す
- **THEN** `isError` が `true` で、本文の `error` は空でない文字列、`retryable` は真偽値、最上位の項目は `error`・`code`・`retryable`・`hint`・`next_actions`・`detail` のどれか

#### Scenario: 故障のエラーも形どおり

- **WHEN** 分類できない例外が投げられる
- **THEN** `code` は `INTERNAL_ERROR`、`error` は例外の文、`retryable` は `false`

#### Scenario: 描画の部品が無いときも JSON で返す

- **WHEN** 描画の部品が読み込めない状態で `render_page` を呼ぶ
- **THEN** 本文は JSON のオブジェクトで、最上位の項目は形どおり

### Requirement: SPEC-READER-COMMON-ERRORS-002 同じ状況には family の共通語彙の code を返す

ファイル・引数・取得の失敗には、houki-hub family の共通語彙の `code` を返す（SHALL）。渡したパスにファイルが無いときは `DOC_NOT_FOUND`、引数の誤り（パスが無い・相対パス・`..` を含むパス・拡張子が `.pdf` でない・ページ指定の誤り・URL の誤り）は `INVALID_ARGUMENT`、サイズの上限を超えたときは `FILE_TOO_LARGE` にする（SHALL）。reader 固有のコードは、描画の部品が読み込めないときの `RENDERER_NOT_AVAILABLE` だけで、共通語彙と同じ意味の別名を返さない（SHALL）。

#### Scenario: 存在しないパスは DOC_NOT_FOUND

- **WHEN** 存在しない絶対パスを渡す
- **THEN** `code` は `DOC_NOT_FOUND`

#### Scenario: 相対パスは INVALID_ARGUMENT

- **WHEN** 相対パスを渡す
- **THEN** `code` は `INVALID_ARGUMENT`

#### Scenario: 範囲外のページは INVALID_ARGUMENT

- **WHEN** 1 ページの文書に `pages: "5"` を渡す
- **THEN** `code` は `INVALID_ARGUMENT`

#### Scenario: 描画の部品が無いときは RENDERER_NOT_AVAILABLE

- **WHEN** 描画の部品が読み込めない状態で `render_page` を呼ぶ
- **THEN** `code` は `RENDERER_NOT_AVAILABLE`、`error` は部品の名前と入れ方を含む

### Requirement: SPEC-READER-COMMON-ERRORS-003 PDF として読めないファイルは INVALID_PDF の所見として返す

ファイルが ISO 32000 の構造の条文に反していて書かれたとおりに読めないときは、ファイルを受け取る 17 ツールのどれでも `code: "INVALID_PDF"` を返し、`INTERNAL_ERROR` で返さない（SHALL）。`hint` に、これは文書についての所見であって、この server の故障ではないこと（"This is a finding about the file, not a failure of this server"）を書く（SHALL）。0 バイトのファイルと PDF でないファイルは ISO 32000-2 §7.5.2（ファイルは `%PDF-` で始まる。R-7.5.2-1）に、途中で切れたファイルは §7.5.5（最後の行は `%%EOF`、その前に `startxref`。R-7.5.5-2・R-7.5.5-3）に反するので、ここに入る。暗号化のため読めない文書は `ENCRYPTED_PDF` で、ここには入らない。

#### Scenario: 0 バイトのファイルは 17 ツールとも INVALID_PDF

- **WHEN** ファイルを受け取る 17 ツールのそれぞれに 0 バイトのファイルを渡す
- **THEN** どのツールも `code` は `INVALID_PDF` で、`hint` は所見であることを書いている

#### Scenario: PDF でないファイルは 17 ツールとも INVALID_PDF

- **WHEN** 17 ツールのそれぞれに、中身が英文のテキストのファイルを渡す
- **THEN** どのツールも `code` は `INVALID_PDF`

#### Scenario: 途中で切れた PDF は 17 ツールとも INVALID_PDF

- **WHEN** 17 ツールのそれぞれに、正しい PDF の先頭 3 分の 1 だけのファイルを渡す
- **THEN** どのツールも `code` は `INVALID_PDF`

### Requirement: SPEC-READER-COMMON-ERRORS-004 retryable は code ごとに 1 つの値にする

`retryable` は、引数・フラグ・環境を変えれば同じ文書についての同じ読み取りが成功しうるかを表し、`code` ごとに 1 つの値に決める（SHALL）。`INVALID_ARGUMENT`・`SOURCE_TIMEOUT`・`SOURCE_UNAVAILABLE`・`RENDERER_NOT_AVAILABLE` は `true`、`DOC_NOT_FOUND`・`INVALID_PDF`・`ENCRYPTED_PDF`・`UNSUPPORTED_PDF_FEATURE`・`FILE_TOO_LARGE`・`SOURCE_API_ERROR`・`INTERNAL_ERROR` は `false` にする（SHALL）。

#### Scenario: 引数の誤りは再試行できる

- **WHEN** 相対パスを渡す
- **THEN** `retryable` は `true`

#### Scenario: 存在しないパスは再試行できない

- **WHEN** 存在しない絶対パスを渡す
- **THEN** `retryable` は `false`

#### Scenario: 文書の所見は再試行できない

- **WHEN** PDF でないファイルを渡す
- **THEN** `retryable` は `false`

#### Scenario: 描画の部品が無いときは再試行できる

- **WHEN** 描画の部品が読み込めない状態で `render_page` を呼ぶ
- **THEN** `retryable` は `true`

#### Scenario: すべての code に値が決まっている

- **WHEN** サーバーが返しうる `code` を 1 つずつ確かめる
- **THEN** どの `code` にも `retryable` の値が 1 つ決まっている

### Requirement: SPEC-READER-COMMON-ERRORS-005 文の項目は英語で書き、分岐に使う値は変えない

エラーの本文の `error`・`hint`・`next_actions[].reason` は英語で書く（SHALL）。受け側が分岐と再試行に使う `next_actions[].action` の値と `example` のキーは、`verify_file_path`・`get_page_count`・`inspect_structure`・`split_pdf`・`retry_later`・`verify_url` から変えない（SHALL）。HTTP が成功以外を返したとき（`SOURCE_API_ERROR`）の `next_actions` は `verify_url` にする（SHALL）。

#### Scenario: どの失敗の文も英語

- **WHEN** 存在しないパス・PDF でないファイル・0 バイトのファイル・相対パス・範囲外のページ・鍵を導けない暗号化文書のそれぞれを渡す
- **THEN** どの本文の `error`・`hint`・`next_actions[].reason` にも、かな・漢字が無い

#### Scenario: next_actions の action の値は変わらない

- **WHEN** 存在しないパスを渡す
- **THEN** `next_actions[0].action` は `verify_file_path`

#### Scenario: HTTP の失敗は verify_url を案内する

- **WHEN** URL の取得で HTTP が成功以外を返す
- **THEN** `code` は `SOURCE_API_ERROR`、`retryable` は `false`、`next_actions` の `action` は `verify_url` だけ

### Requirement: SPEC-READER-COMMON-ERRORS-006 鍵を導けない暗号化文書には reader で取れる手だけを案内する

ファイル暗号鍵を導けない文書（ISO 32000-2 §7.6.4.3.2。空の利用者パスワードで鍵が導けない）について、エラーの `hint` と `locate_objects` の各オブジェクトの `reason` は、reader がパスワードを受け取らないためこの文書を読めないことと、利用者が取れる手（パスワードを持つツールで復号したファイルを渡す）を書く（SHALL）。reader にパスワードを渡せるかのような案内（"Supply the user password" など）を書かない（SHALL）。暗号化を扱えないかのような言い方もしない（空の利用者パスワードの文書は復号して読んでいる）（SHALL）。

#### Scenario: 暗号化文書のエラーは reader が受け取らないことを書く

- **WHEN** 利用者パスワード付きの文書を `read_text` に渡す
- **THEN** `code` は `ENCRYPTED_PDF`、`hint` は `7.6.4.3.2` を含み、reader がパスワードを受け取らないことと、復号したファイルを渡す手を書いていて、"Supply the user password" を含まない

#### Scenario: locate_objects の reason もパスワードを求めない

- **WHEN** 利用者パスワード付きの文書の、相互参照表に載っているオブジェクトを `locate_objects` で探す
- **THEN** そのオブジェクトの `reason` は "Supply the user password" を含まず、reader がパスワードを受け取らないことを書いている

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

### Requirement: SPEC-READER-COMMON-ERRORS-008 入力を読めないファイルシステムのエラーは INVALID_ARGUMENT にする

入力のファイルを読めないファイルシステムのエラー（Node の例外の `code` が `EACCES`・`EPERM`・`EISDIR`・`ENOTDIR` など）は、`INTERNAL_ERROR` ではなく `INVALID_ARGUMENT`（`retryable: true`）で返す（SHALL）。`error` は入力のパスを名指し、`detail` に `reason`（`PERMISSION_DENIED`・`NOT_A_DIRECTORY`・`IS_A_DIRECTORY`・`READ_ONLY_FILESYSTEM`・`NO_SPACE`・`FILESYSTEM_ERROR` のどれか。pdf-writer-mcp と同じ値）・`path`・`cause`（元の例外の文）を書く（SHALL）。`ENOENT` は今までどおり `DOC_NOT_FOUND` にする（SHALL）。権限が無いことはサーバーの故障ではなく、パスか権限を変えれば同じ読み取りが成功しうるためである（pdf-agent-stack `docs/specs/06` §2.3）。

#### Scenario: 読み取り権限の無いファイル

- **WHEN** `chmod 000` したファイルを `get_page_count` に渡す（root で走るときは飛ばす）
- **THEN** `code` は `INVALID_ARGUMENT`、`retryable` は `true`、`detail.reason` は `PERMISSION_DENIED`、`detail.path` と `error` に渡したパスがある

#### Scenario: EACCES の例外の分類

- **WHEN** `code: "EACCES"` と `path` を持つ例外を `handleStructuredError` に渡す
- **THEN** `code` は `INVALID_ARGUMENT`、`detail.reason` は `PERMISSION_DENIED`、`detail.cause` は元の例外の文

#### Scenario: 存在しないパスは今までどおり DOC_NOT_FOUND

- **WHEN** `code: "ENOENT"` を持つ例外を `handleStructuredError` に渡す
- **THEN** `code` は `DOC_NOT_FOUND`
