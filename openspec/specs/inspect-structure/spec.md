---
spec_id: READER
kind: tool
introduced_by: inspect-structure-unreadable-line
---
# inspect-structure

## Purpose

`inspect_structure` ツールが返す文書の骨格（目録の項目・ページ木・間接オブジェクトの数え上げ・版・暗号化の有無）と、その Markdown 表示を定めます。
答えるのは「この文書には何が何個あるか」だけで、規格に照らした合否は言いません（合否は pdf-verify-mcp の仕事）。

この初版は、2026-10-15 時点の既存テスト（`tests/e2e/04-tier2-structure.test.ts` の IS-*、`tests/tier1/structure-service.test.ts`）が固定している振る舞いを起こしたもので、期待値は変えていません。

## できないこと

- 間接参照（`ref`）を解決して中身を出すこと（`locate_objects` / `inspect_catalog` の仕事）
- 規格に照らして「この構造でよいか」を判定すること（pdf-verify-mcp の仕事）
- 鍵が導けない暗号化文書のオブジェクトを数えること（読めなかったことは `note` に書く）

## Requirements

### Requirement: SPEC-READER-INSPECT-STRUCTURE-001 目録の項目は key・type・value で、type は ISO 32000-2 §7.3 の COS 型

応答の `catalog` は目録辞書（§7.7.2）の項目の配列で、各項目は `key`・`type`・`value` を持つ（SHALL）。`type` は §7.3 の COS 型（`boolean` / `integer` / `real` / `string` / `name` / `array` / `dict` / `stream` / `ref` / `null`）のどれかで、ライブラリの内部クラス名を出さない（SHALL）。参照は解決せず、`type` を `ref`、`value` を `ref(<番号>)` の形で返す（SHALL）。

#### Scenario: 目録の項目が COS 型で並ぶ
- **WHEN** 1 ページの単純な PDF を読む
- **THEN** `catalog` は 1 件以上で、各項目の `type` は §7.3 の 10 種のどれか

#### Scenario: /Pages は解決しない参照として出る
- **WHEN** 目録に `/Pages` が間接参照で書かれた PDF を読む
- **THEN** `key` が `Pages` の項目の `type` は `ref`、`value` は `ref(<番号>)` の形

### Requirement: SPEC-READER-INSPECT-STRUCTURE-002 ページ木の総ページ数と MediaBox の標本

応答の `pageTree.totalPages` は文書の総ページ数で（SHALL）、`pageTree.mediaBoxSamples` は先頭の数ページの `MediaBox`（§7.7.3.3、継承した値を含む）を `page`・`width`・`height`（pt）で返す（SHALL）。

#### Scenario: 総ページ数が一致する
- **WHEN** ページ数が分かっている検体を読む
- **THEN** `pageTree.totalPages` はその数

#### Scenario: A4 の MediaBox が標本に出る
- **WHEN** A4（595.28 × 841.89 pt）の検体を読む
- **THEN** `mediaBoxSamples[0]` の `width` と `height` がその値（0.5 pt 未満の誤差を許す）

### Requirement: SPEC-READER-INSPECT-STRUCTURE-003 間接オブジェクトの数え上げは COS 型ごとに数え、ライブラリのクラス名を出さない

応答の `objectStats` は `totalObjects`（読めた間接オブジェクトの数）・`streamCount`・`byType` を持つ（SHALL）。`byType` の鍵は §7.3 の COS 型で（SHALL）、`integer` と `real` は分けて数える（SHALL。§7.3.3）。

#### Scenario: objectStats が埋まる
- **WHEN** 1 ページの単純な PDF を読む
- **THEN** `totalObjects` は 1 以上、`streamCount` は 0 以上、`byType` はオブジェクト

#### Scenario: byType の鍵は COS 型だけ
- **WHEN** 1 ページの単純な PDF を読む
- **THEN** `byType` の鍵はすべて §7.3 の 10 種のどれかで、`PDF` で始まる名前は無い

### Requirement: SPEC-READER-INSPECT-STRUCTURE-004 辞書の /Type は byDocType に分けて数える

応答の `objectStats.byDocType` は、辞書とストリームの `/Type` の名前ごとの数で（SHALL）、`byType`（COS 型）とは別の欄にする（SHALL）。

#### Scenario: Catalog・Pages・Page が数えられる
- **WHEN** 1 ページの単純な PDF を読む
- **THEN** `byDocType.Catalog` は 1、`byDocType.Pages` と `byDocType.Page` は 1 以上

### Requirement: SPEC-READER-INSPECT-STRUCTURE-005 読めなかったオブジェクトは unreadable に分けて数え、欄は常にある

相互参照表に載っているが読めなかった間接オブジェクトの数は `objectStats.unreadable` に入れ、`totalObjects` には混ぜない（SHALL）。`unreadable` は読めなかったものが無いときも `0` として欄を持つ（SHALL）。

#### Scenario: 健全な検体では 0 の欄がある
- **WHEN** 壊れていない 1 ページの PDF を読む
- **THEN** `objectStats.unreadable` は数値の `0`

### Requirement: SPEC-READER-INSPECT-STRUCTURE-006 版はヘッダーと目録の /Version の新しいほう

応答の `pdfVersion` は、ファイルヘッダーの版（§7.5.2）と目録の `/Version`（§7.7.2 Table 29）のうち新しいほうを `<major>.<minor>` の文字列で返す（SHALL）。比較は minor を数値で行う（SHALL）。片方しか無ければその値、どちらも無ければ `null`、目録の値が `<major>.<minor>` の形でなければ無視する（SHALL）。

#### Scenario: 目録の版が新しい
- **WHEN** ヘッダーが `1.4`、目録の `/Version` が `1.7`
- **THEN** `pdfVersion` は `1.7`

#### Scenario: ヘッダーの版が新しい
- **WHEN** ヘッダーが `1.7`、目録の `/Version` が `1.4`
- **THEN** `pdfVersion` は `1.7`

#### Scenario: minor は数値で比べる
- **WHEN** ヘッダーが `1.7`、目録の `/Version` が `1.10`（または その逆）
- **THEN** `pdfVersion` は `1.10`（文字列比較なら `1.7` になるところ）

#### Scenario: 目録の値が形に合わない
- **WHEN** 目録の `/Version` が `abc`
- **THEN** ヘッダーの版を返す

#### Scenario: 検体から版が読める
- **WHEN** 1 ページの単純な PDF を読む
- **THEN** `pdfVersion` は `<major>.<minor>` の形で `null` ではない

### Requirement: SPEC-READER-INSPECT-STRUCTURE-007 暗号化の有無を isEncrypted で返す

応答の `isEncrypted` は、トレーラーに `/Encrypt` がある（§7.6.2）かどうかを返す（SHALL）。

#### Scenario: 暗号化していない検体
- **WHEN** 暗号化していない検体を読む
- **THEN** `isEncrypted` は `false`

### Requirement: SPEC-READER-INSPECT-STRUCTURE-008 線形化 PDF でも例外を投げない

線形化（Annex F）された PDF を読んでも例外を投げず、読めた範囲の応答を返す（SHALL）。

#### Scenario: 線形化 PDF を読む
- **WHEN** 線形化された検体を読む
- **THEN** 応答が返り、`pageTree.totalPages` は 1 以上
