---
approved: 2026-11-06
pr: 51
implementation: required
targets: [common-errors]
---

# Proposal

## Why

読み取り権限の無いファイルを渡すと、reader は `code: "INTERNAL_ERROR"`（`retryable: false`）で返します（#49）。

```jsonc
{ "error": "Permission denied.", "code": "INTERNAL_ERROR", "retryable": false,
  "hint": "Check that this server is allowed to read the file.", "detail": { "cause": "EACCES: ..." } }
```

pdf-agent-stack `docs/specs/06` §2.3 では、`INTERNAL_ERROR` はサーバー側の故障だけに使います。権限が無いのは、パスを変えるか権限を直せば成功しうる状況です。該当は `src/utils/error-handler.ts` の `inferFamilyCodeFromMessage`（`EACCES` → `INTERNAL_ERROR`）と `buildInferredError` です。

ファイルシステムのエラーの扱いは family 全体で決めました（2026-11-06）: 入力を読めない・出力を書けないは `INVALID_ARGUMENT`（`retryable: true`）にし、`detail.cause` に元の文を入れます。共通のコードは足しません。`ENOENT` は従来どおり `DOC_NOT_FOUND` です。pdf-writer-mcp#10（F-23。出力側）と、文面と `detail.reason` の値をそろえます。

## What Changes

- ファイルを読めない例外（`EACCES`・`EPERM`・`EISDIR`・`ENOTDIR`）を `INVALID_ARGUMENT` にする。`error` は `Cannot read the input file "<path>": permission denied (EACCES)` の形で**入力のパス**を名指し、`detail` は `{ reason, path, cause }`。`reason` の値は writer と同じ（`PERMISSION_DENIED`・`NOT_A_DIRECTORY`・`IS_A_DIRECTORY`・`READ_ONLY_FILESYSTEM`・`NO_SPACE`・`FILESYSTEM_ERROR`）。
- 例外の見分けは、文面ではなく Node の例外の `code`（`errno` の名前）で行う。文面の照合（`EACCES` を含むか）は、`code` を持たない経路のために残す。
- `ENOENT` は今までどおり `DOC_NOT_FOUND`。

### 変わる振る舞い

- 読み取り権限の無いファイルの `code`（`INTERNAL_ERROR` → `INVALID_ARGUMENT`）・`retryable`（`false` → `true`）・`error`・`detail`。

### 変わらない振る舞い

- 存在しないパス（`DOC_NOT_FOUND`）、PDF でないファイル（`INVALID_PDF`）、相対パスなど SDK の前段で落ちる入力検証。
- `INVALID_ARGUMENT` の `retryable: true`（SPEC-READER-COMMON-ERRORS-004 の表は変えない）。

### 対象外

- `read_url` のネットワークのエラー（SPEC-READER-COMMON-ERRORS-007）。

## Capabilities

- `common-errors`（ADDED: 008）

## 人が判断すること

- root で走る CI での扱い（Issue の決定で「提案で決める」とされたもの）。`chmod 000` の実物のテストは、`process.getuid() === 0` のときは飛ばします（root は権限の検査を受けないため）。代わりに、`code: "EACCES"` を持つ例外を `handleStructuredError` に渡す単体のテストを、root でも走る形で置きます。GitHub Actions の runner は root ではないので、CI では実物のテストも走ります。
- `detail.reason` の値（writer と同じ 6 つ）。
