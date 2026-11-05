# Design

## 応答の形

```jsonc
{
  "error": "The file does not appear to be a valid PDF.",
  "code": "INVALID_PDF",
  "retryable": false,
  "hint": "The file breaks a structural rule of ISO 32000, so it cannot be read as written. This is a finding about the file, not a failure of this server.",
  "next_actions": [
    { "action": "inspect_structure", "reason": "Look at the catalog and page tree to see where the file breaks." }
  ],
  "detail": { "cause": "The PDF file is empty, i.e. its size is zero bytes." }
}
```

名前を変えたコードが無いので、verify・spec のような旧名の併記（`detail.legacyCode`）は付けません。

## `retryable` の値

規約の定義は「引数・フラグ・環境を変えれば成功しうるか」です。verify 0.33.0 と同じく「同じ文書についての同じ読み取りが成功しうるか」で決めます。

| `code` | `retryable` | 理由 |
| --- | --- | --- |
| `INVALID_ARGUMENT` | `true` | 引数を直せば同じ文書を読める |
| `DOC_NOT_FOUND` | `false` | verify 0.33.0 と §2.3 の例に合わせる（2026-11-05 本人の判断）。別のファイルを探すのは呼び出し側の仕事 |
| `INVALID_PDF` | `false` | 文書についての所見 |
| `ENCRYPTED_PDF` | `false` | reader には `password` 引数が無く、同じ文書を読めるようにする手が reader の中に無い（verify は `password` を受け取るので `true`） |
| `UNSUPPORTED_PDF_FEATURE` | `false` | reader が扱わない機能 |
| `FILE_TOO_LARGE` | `false` | 上限は利用者が変えられない |
| `SOURCE_API_ERROR` | `false` | HTTP が成功以外を返した。多くは URL の誤り（2026-11-05 本人の判断） |
| `SOURCE_TIMEOUT`・`SOURCE_UNAVAILABLE` | `true` | ネットワークの状態が変われば通る |
| `RENDERER_NOT_AVAILABLE` | `true` | 部品を入れれば同じプロセスで通る（SPEC-READER-RENDER-PAGE-001） |
| `INTERNAL_ERROR` | `false` | サーバーの故障 |

表は `src/errors.ts` に `Record<LawErrorCode, boolean>` で置き、`makeError` が `code` から引きます。`Record` なので、コードを足して値を書き忘れると型検査で落ちます。`makeError`・`PdfReaderError` から `retryable` の引数を外し、エラーを作る箇所では選ばせません。`LawServiceError.retryable` は必須にします。

## 例外の分類

`src/utils/error-handler.ts` の `inferFamilyCodeFromMessage` の前に、例外の名前で分ける関数を置きます。

| 投げるもの | 名前 / 文 | `code` |
| --- | --- | --- |
| 文書を開く部品（テキスト系 9 ツール） | 名前 `InvalidPDFException` | `INVALID_PDF` |
| 同上 | 名前 `PasswordException` | `ENCRYPTED_PDF` |
| 描画の部品（`render_page`。名前を持たない） | 文 `File not in PDF format or corrupted` | `INVALID_PDF` |
| 同上 | 文 `Password required or incorrect password`・`Unsupported security scheme` | `ENCRYPTED_PDF` |

文の照合（今の分岐）は、名前で決まらなかったときの補助として残します。

## 文面

- `NEXT_ACTIONS` の `reason` 6 件と、`buildInferredError` の `hint` 7 件を英語にします。`action` と `example` は変えません。
- `INVALID_PDF` の `hint` は、条文に反した文書であることと "This is a finding about the file, not a failure of this server." を書きます（verify の `STRUCTURAL_REFUSAL_HINT` と同じ趣旨）。
- `ENCRYPTED_PDF` の `hint`: 鍵が導けないので間接オブジェクトを 1 つも読めない（§7.6.4.3.2。ページ数も含む）こと、reader はパスワードを受け取らないこと、パスワードを持つツールで復号したファイルを渡せば読めること。pdf-verify-mcp の `password` 引数（`verify_signatures`・`validate_conformance`・`evaluate_policy`）は署名と適合の検証のためで、中身は取り出さないことも書きます。
- `src/services/object-locator.ts` の「Supply the user password.」を同じ趣旨に書き直します。
- `src/services/validation-service.ts`（`compare_structure`）の日本語の `hint` 2 件を英語にします。
- `SOURCE_API_ERROR`（旧名 `FETCH_FAILED`）の既定の `next_actions` を `retry_later` から `verify_url` にします。

## `render_page` の描画の部品

`src/tools/tier1/render-page.ts` が平文の `RENDERER_MISSING_MESSAGE` を返している箇所と、`renderPages` が `new Error(RENDERER_MISSING_MESSAGE)` を投げている箇所を、`PdfReaderError`（`familyCode: 'RENDERER_NOT_AVAILABLE'`）に変えます。`error` は `RENDERER_MISSING_MESSAGE` のまま、`hint` は「部品を入れればこのプロセスのままもう一度呼べる」ことを書きます。読み込みをやり直す作り（SPEC-READER-RENDER-PAGE-001）は変えません。

## 2 つの読み方が両方失敗したとき

`src/services/reading-scope.ts` の `bothFailedError` は `makeError` を通るので、`retryable` は表から自動で付きます。

## ライブラリの制約と仕様の制約

- 仕様の制約: 0 バイトのファイルと PDF でないファイルは ISO 32000-2 §7.5.2 の R-7.5.2-1（ファイルは `%PDF-` で始まる）に、途中で切れたファイルは §7.5.5 の R-7.5.5-2・R-7.5.5-3（最後の行は `%%EOF`、その前に `startxref` とバイトオフセット）に反する。2026-11-05 に pdf-spec-mcp の `get_requirements` で原文を確かめた。鍵の導出は §7.6.4.3.2。
- ライブラリの制約: テキスト系のツールが使う部品（pdfjs-dist 4.10.38）は、0 バイトのファイルに `InvalidPDFException`（名前で分けられる）を投げる。描画の部品（@hyzyla/pdfium 2.1.13）は `FPDF_GetLastError` の値を文にした素の `Error` を投げ、名前を持たない。`FPDF_ERR_FORMAT`（3）が「File not in PDF format or corrupted」、`FPDF_ERR_PASSWORD`（4）と `FPDF_ERR_SECURITY`（5）が暗号の失敗。描画は worker スレッドで動き、例外は `error` イベントで文だけが渡る。
- Requirement にはライブラリ名を書かず、条文で書く。
