---
approved:
pr:
implementation: required
targets: [common-errors]
---

# Proposal

## Why

PDF family のエラー応答の規約（pdf-agent-stack `docs/specs/06` §2.3。2026-11-04 改訂、pdf-agent-stack#48）は、ツール結果の本文を平らな JSON（`error` 英語の文・`code`・`retryable` が必須、`hint`・`next_actions`・`detail` が任意）にし、文の項目を英語で書き、同じ状況には同じ `code` を返すと定めました。

0.18.1 の reader は、この規約に 3 点で反しています（pdf-agent-stack `eval/e2e/tests/s6-error-contract.test.mjs` で `get_page_count` の 4 件とも落ちる）。

1. **`retryable` を書かない**（#44）。型 `LawServiceError` で `retryable` が任意になっていて、書いているのは `SOURCE_UNAVAILABLE`・`SOURCE_TIMEOUT` の 2 か所だけです。
2. **`hint` と `next_actions[].reason` が日本語**（#43・F-10）。`error` は英語なので、1 つの応答の中で言語が切り替わります。
3. **PDF として読めないファイルの一部を `INTERNAL_ERROR`（この server の故障）で返す**（#40・F-05・F-06）。2026-11-05 に 0.18.1 のビルドで 17 ツールに 4 種類の入力を渡した結果:

| 入力 | `INTERNAL_ERROR` を返すツール |
| --- | --- |
| 0 バイトのファイル | `get_page_count`・`get_metadata`・`read_text`・`search_text`・`read_images`・`render_page`・`summarize`・`inspect_annotations`・`compare_structure`（9 ツール） |
| PDF でないファイル | `render_page` |
| 途中で切れた PDF | `render_page` |

原因は、文書を開く部品の例外を分類していないことです。0 バイトのファイルで投げられる例外の名前は `InvalidPDFException`（文は「The PDF file is empty, i.e. its size is zero bytes.」）、`render_page` の描画の部品が投げる文は「File not in PDF format or corrupted」で、どちらも `src/utils/error-handler.ts` の `inferFamilyCodeFromMessage` の分岐に当たらず、既定の `INTERNAL_ERROR` に落ちます。`INTERNAL_ERROR` には `hint` も `next_actions` も付きません。

あわせて、文面の問題が 2 つあります。

4. **reader に無い `password` 引数を案内する**（#43・F-07）。鍵を導けない暗号化文書に対し、`hint` は「利用者パスワードが必要です」、`locate_objects` の各オブジェクトの `reason` は「Supply the user password.」と書きます。reader のツールに `password` 引数はありません。
5. **`render_page` の描画の部品が無いとき、本文が JSON でない平文で返る**。§2.3 の形に反します（S6 と Issue は扱っていなかった。2026-11-05 に本人の判断でこの変更に含めた）。

エラーの振る舞いを固定している仕様はまだありません。18 ツールに共通する振る舞いなので、共通の capability `common-errors`（`kind: common`）として初版を起こします。verify（0.33.0）・spec（0.12.0）と同じ形です。

## What Changes

- `retryable` を常に書く。値は `code` ごとに 1 つに決め、エラーを作る箇所では選ばせない（design.md の表）。型の `retryable` を必須にする。
- `hint`・`next_actions[].reason` を英語にする。`next_actions[].action`・`example` の値は変えない（`SOURCE_API_ERROR` を除く。下の「変わる振る舞い」）。
- 文書を開く部品の例外を、文ではなく例外の名前で分類する。`InvalidPDFException` は `INVALID_PDF`、`PasswordException` は `ENCRYPTED_PDF`。名前を持たない描画の部品の例外は文で分類する（「File not in PDF format or corrupted」は `INVALID_PDF`、「Password required or incorrect password」「Unsupported security scheme」は `ENCRYPTED_PDF`）。
- `INVALID_PDF` の `hint` に、これが文書についての所見で、この server の故障ではないことを書く（§2.3）。
- 鍵を導けない暗号化文書の文面を、reader では読めないことと、利用者が取れる手（パスワードを持つツールで復号したファイルを渡す。pdf-verify-mcp の `password` 引数は検証のためのもので、中身は取り出さない）に書き直す。`locate_objects` の `reason` も同じ。
- `render_page` の描画の部品が無いときは、reader 固有のコード `RENDERER_NOT_AVAILABLE`（`retryable: true`）を §2.3 の形で返す。`error` は 0.18.1 の平文と同じ内容にする。

### 変わる振る舞い

- エラーの本文に `retryable` が加わる。
- `hint`・`next_actions[].reason` の文言が英語に変わる。
- 0 バイトのファイル・PDF でないファイル・途中で切れた PDF の `code` が、上の表のツールで `INTERNAL_ERROR` から `INVALID_PDF` に変わる。`hint` と `next_actions` が付く。
- `render_page` の描画の部品が無いときの本文が、平文から JSON（`code: "RENDERER_NOT_AVAILABLE"`）に変わる。
- `SOURCE_API_ERROR`（`read_url` で HTTP が成功以外を返した）の `next_actions` が `retry_later` から `verify_url` に変わる（`retryable: false` にそろえるため。本人の判断）。
- `compare_structure` で 2 つのファイルのどちらかが読めないときの `hint` が英語に変わる。

### 変わらない振る舞い

- 成功したときの出力（18 ツールとも）。ただし `locate_objects` の、鍵を導けない文書のオブジェクトの `reason` の文言は上のとおり変わる。
- どの入力がエラーになるか。`code` の名前（新しく足す `RENDERER_NOT_AVAILABLE` を除く）。`error` の文言（`render_page` の描画の部品が無いときは同じ内容を JSON に入れる）。
- `next_actions[].action` の値（`SOURCE_API_ERROR` を除く）。
- `isError: true` で返すこと。SDK が前段で落とす入力検証の失敗（宣言に無いキーなど）は、SDK の文言のまま返す（§2.11。2026-08-27 決定、#48 で再確認）。
- 描画の部品の読み込みに失敗した結果を覚えないこと（SPEC-READER-RENDER-PAGE-001）。

### 対象外

- reader に `password` 引数を足すこと（#43 で範囲外と決めている）。
- 読み取り権限の無いファイル（`EACCES`）を `INTERNAL_ERROR` で返していること。§2.3 では `INTERNAL_ERROR` はサーバーの故障だけに使うので反しているが、どの共通語彙に当てるかを決めてから別の Issue で直す。
- `tools/list` のツールの説明文の中の日本語の語（「新旧対照表」など。例示であって、エラーの文ではない）。
- pdf-agent-stack 側の追随（§2.3 の reader 固有のコードの表と、S6 の `SPECIFIC.reader` に `RENDERER_NOT_AVAILABLE` を足す）。pdf-agent-stack#48 で行う。

## Capabilities

- `common-errors`（新規。`kind: common`。ADDED: 001〜006）

## 人が判断すること

- 版。`code` の値が変わる（0 バイトなどが `INVALID_PDF` に、`RENDERER_NOT_AVAILABLE` が加わる）ので minor（0.19.0）を提案します。旧名の併記は要りません（名前を変えたコードが無い）。
- `retryable` の値（design.md の表）。`DOC_NOT_FOUND` を `false`（verify 0.33.0 と §2.3 の例に合わせる）、`SOURCE_API_ERROR` を `false` にすることは 2026-11-05 に本人が決めた。`ENCRYPTED_PDF` は verify と違って `false`（reader には `password` 引数が無く、同じ文書を読めるようにする手が reader の中に無い）。
- `RENDERER_NOT_AVAILABLE` という名前。
