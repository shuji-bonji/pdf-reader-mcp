# PDF Reader MCP Server

[![npm version](https://img.shields.io/npm/v/@shuji-bonji/pdf-reader-mcp)](https://www.npmjs.com/package/@shuji-bonji/pdf-reader-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-blueviolet?logo=anthropic)](https://claude.ai/code)

[English](./README.md) | **日本語**

PDF 内部構造解析に特化した MCP (Model Context Protocol) サーバー。

既存の pdf-reader-mcp がテキスト抽出の薄いラッパーに留まるのに対し、本プロジェクトは **PDF の内部構造を読み解く** ことに焦点を当てています。[pdf-spec-mcp](https://github.com/shuji-bonji/pdf-spec-mcp) と組み合わせることで、仕様知識に基づいた構造解析・検証が可能になります。

## 機能

**15 ツール** を 3 層構成で提供します。

### Tier 1: 基本機能

| ツール           | 説明                                                  |
| ---------------- | ----------------------------------------------------- |
| `get_page_count` | ページ数の軽量取得                                    |
| `get_metadata`   | メタデータ抽出（タイトル、著者、PDF版、タグ有無等）   |
| `read_text`      | テキスト抽出（Y座標ベースの読み順保持）               |
| `search_text`    | 全文検索（前後コンテキスト付き）                      |
| `read_images`    | 画像抽出（base64、メタデータ付き）                    |
| `read_url`       | URLからリモートPDFを取得して処理                      |
| `summarize`      | 全体概要レポート（メタデータ + テキスト + 画像数）    |

### Tier 2: 構造解析

| ツール                | 説明                                         |
| --------------------- | -------------------------------------------- |
| `inspect_structure`   | オブジェクトツリー・カタログ辞書の解析       |
| `inspect_tags`        | Tagged PDF のタグツリー可視化                |
| `inspect_fonts`       | フォント一覧（埋め込み/サブセット/Type判定） |
| `inspect_annotations` | 注釈一覧（タイプ別分類）                     |
| `inspect_signatures`  | 電子署名フィールドの構造解析                 |

### Tier 3: 検証・分析

| ツール              | 説明                                           |
| ------------------- | ---------------------------------------------- |
| `validate_tagged`   | PDF/UA タグ構造の検証（8項目チェック）         |
| `validate_metadata` | メタデータの仕様適合チェック（10項目チェック） |
| `compare_structure` | 2つのPDFの構造差分比較（プロパティ＋フォント） |

## インストール

### npx（推奨）

```bash
npx @shuji-bonji/pdf-reader-mcp
```

### Claude Desktop

`claude_desktop_config.json` に追加:

```json
{
  "mcpServers": {
    "pdf-reader-mcp": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/pdf-reader-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add pdf-reader-mcp -- npx -y @shuji-bonji/pdf-reader-mcp
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

## 技術スタック

- **TypeScript** + MCP TypeScript SDK
- **pdfjs-dist** (Mozilla) — テキスト/画像抽出、タグツリー、注釈
- **pdf-lib** — 低レベルオブジェクト構造解析
- **Vitest** — Unit + E2E テスト（157 tests）
- **Biome** — lint + format
- **Zod** — 入力バリデーション

## テスト

```bash
npm test              # 全テスト実行（Unit: 39 tests）
npm run test:e2e      # E2E のみ（118 tests）
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
│   │   ├── tier2/            # 構造解析 (5)
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
    └── e2e/                  # E2E tests (9 suites, 118 tests)
```

## pdf-spec-mcp との連携

[pdf-spec-mcp](https://github.com/shuji-bonji/pdf-spec-mcp) は PDF 仕様（ISO 32000-2 等）の知識を提供する MCP サーバーです。両方を有効にすることで、LLM は以下のような仕様知識ベースのワークフローを実行できます:

1. `summarize` で PDF の概要を把握
2. `inspect_tags` でタグ構造を確認
3. pdf-spec-mcp の `get_requirements` で PDF/UA 要件を取得
4. `validate_tagged` で適合性を検証
5. `compare_structure` で修正前後の構造差分を確認

## ライセンス

MIT
