# PDF Reader MCP Server

[![npm version](https://img.shields.io/npm/v/@shuji-bonji/pdf-reader-mcp)](https://www.npmjs.com/package/@shuji-bonji/pdf-reader-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-blueviolet?logo=anthropic)](https://claude.ai/code)

[English](./README.md) | **日本語**

PDF 内部構造解析に特化した MCP (Model Context Protocol) サーバー。

既存の pdf-reader-mcp がテキスト抽出の薄いラッパーに留まるのに対し、本プロジェクトは **PDF の内部構造を読み解く** ことに焦点を当てています。[pdf-spec-mcp](https://github.com/shuji-bonji/pdf-spec-mcp) と組み合わせることで、仕様知識に基づいた構造解析・検証が可能になります。

### PDF family

| サーバー | 役割 |
|---------|------|
| [pdf-spec-mcp](https://github.com/shuji-bonji/pdf-spec-mcp) | PDF 仕様知識（ISO 32000・PDF/A・PDF/UA） |
| **pdf-reader-mcp**（本サーバー） | PDF 内部構造の読取・検査 — 「何があるか」 |
| [pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp) | 真正性検証 — 「それが本物か」: 電子署名の暗号学的検証・改ざん検知・PAdES レベル判定・PDF/A 検証・暗号化PDF復号 |

`pdf-reader-mcp` は署名の**構造**を検査します（`inspect_signatures`）。**暗号学的**な署名検証・信頼/失効評価・PDF/A 準拠検証は `pdf-verify-mcp` を使ってください。

## 機能

**16 ツール** を 3 層構成で提供します。

### Tier 1: 基本機能

| ツール           | 説明                                                  |
| ---------------- | ----------------------------------------------------- |
| `get_page_count` | ページ数の軽量取得                                    |
| `get_metadata`   | メタデータ抽出（タイトル、著者、PDF版、タグ有無等）   |
| `read_text`      | テキスト抽出（Y座標ベースの読み順保持。`split_columns: 2 \| 3` で **タグなし** 多カラム PDF、`compact_whitespace` で 帳票 の U+3000 連続空白を畳み込み） |
| `search_text`    | 全文検索（前後コンテキスト付き）                      |
| `read_images`    | 画像抽出（base64、メタデータ付き）                    |
| `read_url`       | URLからリモートPDFを取得して処理                      |
| `summarize`      | 全体概要レポート（メタデータ + テキスト + 画像数）    |

### Tier 2: 構造解析

| ツール                | 説明                                                     |
| --------------------- | -------------------------------------------------------- |
| `inspect_structure`   | オブジェクトツリー・カタログ辞書の解析                   |
| `inspect_tags`        | Tagged PDF のタグツリー可視化                            |
| `inspect_fonts`       | フォント一覧（埋め込み/サブセット/Type判定）             |
| `inspect_annotations` | 注釈一覧（タイプ別分類）                                 |
| `inspect_signatures`  | 電子署名フィールドの構造解析                             |
| `extract_tables`      | Tagged PDF の `<Table>` を Markdown テーブルとして抽出   |

### Tier 3: 検証・分析

| ツール              | 説明                                           |
| ------------------- | ---------------------------------------------- |
| `validate_tagged`   | PDF/UA タグ構造の検証（8項目チェック）         |
| `validate_metadata` | メタデータの仕様適合チェック（10項目チェック） |
| `compare_structure` | 2つのPDFの構造差分比較（プロパティ＋フォント） |

## インストール

### npx（推奨）

```bash
npx @shuji-bonji/pdf-reader-mcp@latest
```

### Claude Desktop

`claude_desktop_config.json` に追加:

```json
{
  "mcpServers": {
    "pdf-reader-mcp": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/pdf-reader-mcp@latest"]
    }
  }
}
```

> **`@latest` を付けてください。** `npx -y <pkg>` の `-y` は**インストール確認を省くだけで、
> 更新確認はしません**。`@latest` が無いと、npx は最初に取得した版をキャッシュから使い続け、
> 新しい版を publish しても利用者には届きません。古い版が動いている疑いがあるときは
> `rm -rf ~/.npm/_npx` を実行してクライアントを再起動してください。

### Claude Code

```bash
claude mcp add pdf-reader-mcp -- npx -y @shuji-bonji/pdf-reader-mcp@latest
```

### ソースから

```bash
git clone https://github.com/shuji-bonji/pdf-reader-mcp.git
cd pdf-reader-mcp
npm install
npm run build
```

## 使用例

### ページ数の取得

```
get_page_count({ file_path: "/path/to/document.pdf" })
→ 42
```

### テキスト検索

```
search_text({
  file_path: "/path/to/spec.pdf",
  query: "digital signature",
  pages: "1-20",
  max_results: 10
})
→ Found 5 matches (page 3, 7, 12, 15, 18)
```

### PDF概要

```
summarize({ file_path: "/path/to/document.pdf" })
→ | Pages | 42 |
  | PDF Version | 2.0 |
  | Tagged | Yes |
  | Signatures | No |
  | Images | 15 |
```

### PDF/UA タグ検証

```
validate_tagged({ file_path: "/path/to/document.pdf" })
→ ✅ [TAG-001] Document is marked as tagged
  ✅ [TAG-002] Structure tree root exists
  ⚠️ [TAG-004] Heading hierarchy has gaps: H1, H3
  ❌ [TAG-005] Document has 3 image(s) but no Figure tags
```

### メタデータ検証

```
validate_metadata({ file_path: "/path/to/document.pdf" })
→ ✅ [META-001] Title: "Annual Report 2025"
  ⚠️ [META-002] Author is missing
  ✅ [META-006] PDF version: 2.0
```

### 構造比較

```
compare_structure({
  file_path_1: "/path/to/v1.pdf",
  file_path_2: "/path/to/v2.pdf"
})
→ | Page Count  | 10 | 12 | ❌ |
  | PDF Version | 1.7 | 2.0 | ❌ |
  | Tagged      | true | true | ✅ |
```

### Tagged PDF からテーブル抽出

```
extract_tables({ file_path: "/path/to/kaisei-tsutatsu.pdf", pages: "1" })
→ # Extracted Tables
  - **Tagged**: Yes / **Pages Scanned**: 1 / **Tables Found**: 1

  ## Page 1 — Table 1

  | 改正後 | 改正前 |
  | --- | --- |
  | …第２条第 16 項《定義》… | …第２条第 15 項《定義》… |
```

タグ無し PDF では空結果と note を返し、下記の column-aware 抽出への
フォールバックを推奨します。

### タグなし多カラム PDF をカラム単位で読む

```
read_text({ file_path: "/path/to/older-shinkyu.pdf", split_columns: 2 })
→ // 通常の Y ソートだとカラムが交互連結:
//   "改正後セル1   改正前セル1\n 改正後セル2   改正前セル2..."
//
// split_columns: 2 では左カラム → 空行 → 右カラムの順:
//   "改正後セル1\n改正後セル2\n…\n\n改正前セル1\n改正前セル2\n…"
```

**タグなし** 多カラム PDF (古い 新旧対照表など) で `split_columns: 2 \| 3` を指定。
タグ付き PDF (`<Table>` 構造あり) では `extract_tables` の方が表構造を保持できます。

### 連続する全角空白を畳み込む（日本語帳票・様式向け）

```
read_text({ file_path: "/path/to/form.pdf", compact_whitespace: true })
→ // 元 PDF が U+3000 で視覚的インデントを表現している場合:
//   " (   )   自   年   月   日   法   有 （   年   月   日）   有   有"
//
// compact_whitespace: true で:
//   "( ) 自 年 月 日 法 有 （ 年 月 日） 有 有"
//
// 国税庁の帳票 PDF で文字数が約 40% 削減できる実例あり。
```

`compact_whitespace` は `split_columns` と直交して併用可能です。

## 技術スタック

- **TypeScript** + MCP TypeScript SDK
- **pdfjs-dist** (Mozilla) — テキスト/画像抽出、タグツリー、注釈
- **pdf-lib** — 低レベルオブジェクト構造解析
- **Vitest** — Unit + E2E テスト（171 tests）
- **Biome** — lint + format
- **Zod** — 入力バリデーション

## テスト

```bash
npm test              # 全テスト実行（Unit: 39 tests）
npm run test:e2e      # E2E のみ（132 tests）
npm run test:watch    # ウォッチモード
```

## アーキテクチャ

```
pdf-reader-mcp/
├── src/
│   ├── index.ts              # MCP Server エントリーポイント
│   ├── constants.ts          # 共通定数
│   ├── types.ts              # 型定義
│   ├── tools/
│   │   ├── tier1/            # 基本ツール (7)
│   │   ├── tier2/            # 構造解析 (6)
│   │   ├── tier3/            # 検証・分析 (3)
│   │   └── index.ts          # ツール登録
│   ├── services/
│   │   ├── pdfjs-service.ts        # pdfjs-dist ラッパー（並列ページ処理）
│   │   ├── pdflib-service.ts       # pdf-lib ラッパー
│   │   ├── validation-service.ts   # 検証・比較ロジック
│   │   └── url-fetcher.ts          # URL 取得
│   ├── schemas/              # Zod バリデーションスキーマ
│   └── utils/
│       ├── pdf-helpers.ts    # PDF ユーティリティ（ページ範囲パース、ファイル I/O）
│       ├── batch-processor.ts # 大規模 PDF 向けバッチ処理
│       ├── formatter.ts      # 出力整形
│       └── error-handler.ts  # エラーハンドリング
└── tests/
    ├── tier1/                # Unit tests
    └── e2e/                  # E2E tests (9 suites, 132 tests)
```

## エラー応答 (houki-hub family contract)

**v0.6.0** より、本 MCP のエラー応答は **houki-hub family 共通契約**に従う構造化レスポンスを返します。`code` 文字列は family 全体で統一された語彙を使用するため、`houki-egov-mcp` / `houki-nta-mcp` と併用しても LLM・Skill 層は一貫したロジックで解釈できます。

- [`docs/ERROR-CODES.md`](https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-CODES.md) — エラーコード語彙の正典 (houki-research-skill)
- [`docs/ERROR-HANDLING.md`](https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-HANDLING.md) — 解釈ポリシー / next_actions テンプレ

実装は **完全に独立** しており、`houki-abbreviations` 等の family パッケージに依存しません。リファレンス実装は [`houki-egov-mcp/src/errors.ts`](https://github.com/shuji-bonji/houki-egov-mcp/blob/main/src/errors.ts)、本 MCP のローカル定義は [`src/errors.ts`](./src/errors.ts) を参照してください。

エラー時は全 tool が `isError: true` を立て、`content[0].text` に `LawServiceError` を JSON 文字列化したものを入れて返します:

```json
{
  "error": "The file does not appear to be a valid PDF.",
  "code": "INVALID_PDF",
  "hint": "ファイルが破損していないか確認してください。",
  "next_actions": [
    {
      "action": "inspect_structure",
      "reason": "PDF が壊れている可能性があります。Catalog / Pages 等の構造を確認してください"
    }
  ],
  "detail": { "cause": "Invalid PDF structure" }
}
```

### 本 MCP で使用するコード

| code | 用途 |
|---|---|
| `INVALID_ARGUMENT` | パス・URL・ページ範囲などクライアント側引数の不正 |
| `DOC_NOT_FOUND` | ファイル未存在 (ENOENT) |
| `INVALID_PDF` | PDF として不正・破損 |
| `ENCRYPTED_PDF` | 暗号化 PDF (現状未対応) |
| `UNSUPPORTED_PDF_FEATURE` | サポート外の PDF 機能 |
| `FILE_TOO_LARGE` | 50MB 上限超過 (pdf-reader 固有) |
| `SOURCE_API_ERROR` | URL fetch の HTTP エラー (4xx/5xx) |
| `SOURCE_TIMEOUT` | リモート取得タイムアウト |
| `SOURCE_UNAVAILABLE` | DNS / 接続失敗 |
| `INTERNAL_ERROR` | パーミッション拒否を含むその他バグ |

### 移行ノート (v0.5.x → v0.6.0)

旧 v0.5.x までは `content[0].text` に `Error: ...\n\nSuggestion: ...` という人間可読な文字列を入れていました。v0.6.0 では同じ場所に **JSON 文字列** が入ります。LLM 側でテキスト解釈に依存していた場合は `JSON.parse(content[0].text)` での解釈に切り替えてください。`isError: true` フラグで構造化エラーかどうかを判定できます。

## pdf-spec-mcp との連携

[pdf-spec-mcp](https://github.com/shuji-bonji/pdf-spec-mcp) は PDF 仕様（ISO 32000-2 等）の知識を提供する MCP サーバーです。両方を有効にすることで、LLM は以下のような仕様知識ベースのワークフローを実行できます:

1. `summarize` で PDF の概要を把握
2. `inspect_tags` でタグ構造を確認
3. pdf-spec-mcp の `get_requirements` で PDF/UA 要件を取得
4. `validate_tagged` で適合性を検証
5. `compare_structure` で修正前後の構造差分を確認

## ライセンス

MIT
