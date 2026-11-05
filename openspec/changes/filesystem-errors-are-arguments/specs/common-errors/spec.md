## ADDED Requirements

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
