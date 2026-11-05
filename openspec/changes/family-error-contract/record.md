# record: family-error-contract

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）のもとでの、pdf-reader-mcp の記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| 版 | OpenSpec 1.14.1 / spec-ids（`npx spec-ids`）/ pdf-reader-mcp 0.18.1 → 0.19.0 の予定（版は人が決める）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-05 |
| きっかけ | pdf-agent-stack#48 でエラー応答の規約（`docs/specs/06` §2.3）を平らな形に書き直し、S6 の契約テストで reader の 4 件が落ちた。Issue は #44（`retryable`）・#43（英語・F-07 / F-10）・#40（0 バイトなどが `INTERNAL_ERROR`・F-05 / F-06） |
| PR の切り方 | 1 本（計画 §6.3）。ブランチ `fix/family-error-contract`。提案の commit の後、人がチャットで承認し（13:52）、同じブランチで実装した。`approved`・`pr` の記入と archive は PR を出した後に行う |
| 仕様を書いた時間 | 約 25 分（13:25〜13:50。Issue・規約・S6・verify の前例の読み込みと、0.18.1 のビルドで 17 ツール × 4 入力を測った時間を含む） |
| 実装した時間 | 約 10 分（13:53〜14:03。受入テスト・実装・ゲート・S6 まで。writer と並べて進めた） |
| 人が判断した箇所 | (1) `DOC_NOT_FOUND` の `retryable` を `false`（verify 0.33.0 に合わせる。#44 の目安は `true`）。(2) `SOURCE_API_ERROR` を `false` にし、`next_actions` を `verify_url` にする。(3) `render_page` の平文のエラーをこの変更に含め、`RENDERER_NOT_AVAILABLE` を足す。(4) 提案の承認 |
| 仕様と実装のずれ | 0 件 |
| エージェントが仕様に無い振る舞いを実装した件数 | 1 件。描画の部品の `Password required or incorrect password`・`Unsupported security scheme` を `ENCRYPTED_PDF` に分類した（design.md の表には書いたが、Requirement には書いていない）。`PasswordException` を名前で分けることも同じ |
| 実装後に仕様を読み返した回数 | 0 回 |
| テスト | `npm test` 459 → 482 件（+1 skip）。`npm run test:e2e` 285 → 300 件（+1 skip）。受入テストは `tests/e2e/18-common-errors.test.ts`（15 件）と `tests/tier1/common-errors.test.ts`（5 件）。変更前の `src/` で 20 件中 16 件が落ちた（通った 4 件は、すでに正しかった `DOC_NOT_FOUND`・`INVALID_ARGUMENT`・`verify_file_path` を固定するもの）。既存の `tests/tier1/errors.test.ts` の 3 件を新しい形に書き換え、名前による分類のテストを 3 件足した。check:engines・lint・format・typecheck・build・check:public-types・test:fixtures は終了コード 0（Node 22） |
| tools/list の比較 | 変更前（`800fc15`）と変更後の `dist` を `pdf-agent-stack/scripts/tools-list-snapshot.mjs` で比べた。18 ツールとも差 0 件 |
| S6（pdf-agent-stack `eval/e2e`） | 公開版（reader 0.18.1・writer 0.23.2・verify 0.33.0・spec 0.12.0）で 18 件中 11 件。このブランチの reader と writer を `PDF_E2E_READER_DIR`・`PDF_E2E_WRITER_DIR` で差し替えて 18 件とも通った |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |

## 分かったこと

1. **`INTERNAL_ERROR` に落ちていたのは 8 ツールではなく 9 ツールだった。** #40 は 8 ツールを挙げていたが、`compare_structure` も 0 バイトのファイルで `INTERNAL_ERROR` を返していた（2 つのファイルの読めなかった理由を、内側の `code` のまま最上位に出していたため）。17 ツールを回す受入テストにしたので、名前を挙げ漏らしても落ちる。
2. **文の照合で分類すると、部品の文言 1 つで故障に化ける。** 0 バイトのファイルの例外は、名前（`InvalidPDFException`）では分かるのに、文（"The PDF file is empty"）がどの分岐にも当たらなかった。名前で先に分け、名前を持たない描画の部品だけ文で分けた。
3. **`render_page` の平文のエラーは S6 にも Issue にも写っていなかった。** S6 は `get_page_count` しか呼ばず、部品の有る環境で回る。§2.3 の reader 固有のコードの表と S6 の `SPECIFIC.reader` への `RENDERER_NOT_AVAILABLE` の追記は、pdf-agent-stack#48 で行う。
