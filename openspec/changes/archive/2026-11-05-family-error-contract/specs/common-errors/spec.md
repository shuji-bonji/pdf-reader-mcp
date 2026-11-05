## ADDED Requirements

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
