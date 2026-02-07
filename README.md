# pdf-reader-mcp

PDF 内部構造解析に特化した MCP (Model Context Protocol) サーバー。

既存の pdf-reader-mcp がテキスト抽出の薄いラッパーに留まるのに対し、本プロジェクトは **PDF の内部構造を読み解く** ことに焦点を当てています。[pdf-spec-mcp](https://github.com/nicholasgriffintn/pdf-spec-mcp) と組み合わせることで、仕様知識に基づいた構造解析・検証が可能になります。

## ツール一覧

### Tier 1: 基本機能 ✅ (v0.1.0)

| ツール | 説明 |
|---|---|
| `get_page_count` | ページ数の軽量取得 |
| `get_metadata` | メタデータ抽出（タイトル、著者、PDF版、タグ有無等） |
| `read_text` | テキスト抽出（Y座標ベースの読み順保持） |
| `search_text` | 全文検索（前後コンテキスト付き） |
| `read_images` | 画像抽出（base64、メタデータ付き） |
| `read_url` | URLからリモートPDFを取得して処理 |
| `summarize` | 全体概要レポート（メタデータ + テキスト + 画像数） |

### Tier 2: 構造解析 🚧 (予定)

| ツール | 説明 |
|---|---|
| `inspect_structure` | オブジェクトツリー・カタログ辞書の解析 |
| `inspect_tags` | Tagged PDF のタグツリー可視化 |
| `inspect_fonts` | フォント一覧（埋め込み/サブセット/Type判定） |
| `inspect_annotations` | 注釈一覧（タイプ別分類） |
| `inspect_signatures` | 電子署名フィールドの構造解析 |

### Tier 3: 検証・分析 🚧 (予定)

| ツール | 説明 |
|---|---|
| `validate_tagged` | PDF/UA 要件との照合 |
| `validate_metadata` | XMP/Info辞書の仕様適合チェック |
| `compare_structure` | 2つのPDFの構造差分比較 |

## セットアップ

### Claude Desktop

`claude_desktop_config.json` に追加:

```json
{
  "mcpServers": {
    "pdf-reader-mcp": {
      "command": "node",
      "args": ["/path/to/pdf-reader-mcp/dist/index.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add pdf-reader-mcp node /path/to/pdf-reader-mcp/dist/index.js
```

### 開発用

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

## 技術スタック

- **TypeScript** + MCP TypeScript SDK
- **pdfjs-dist** (Mozilla) — テキスト/画像抽出
- **pdf-lib** (Tier 2〜) — 低レベル構造解析
- **Vitest** — テスト
- **Zod** — 入力バリデーション

## テスト

```bash
npm test          # テスト実行
npm run test:watch  # ウォッチモード
```

## アーキテクチャ

```
pdf-reader-mcp/
├── src/
│   ├── index.ts           # MCP Server エントリーポイント
│   ├── constants.ts       # 定数
│   ├── types.ts           # 型定義
│   ├── tools/
│   │   ├── tier1/         # 基本ツール（7ツール）
│   │   ├── tier2/         # 構造解析（予定）
│   │   ├── tier3/         # 検証・分析（予定）
│   │   └── index.ts       # ツール登録の集約
│   ├── services/          # PDF ライブラリラッパー
│   ├── schemas/           # Zod バリデーションスキーマ
│   └── utils/             # ユーティリティ
└── tests/
```

## pdf-spec-mcp との連携

pdf-spec-mcp は PDF 仕様（ISO 32000-2 等）の知識を提供する MCP サーバーです。両方を有効にすることで、LLM は以下のようなワークフローを実行できます:

1. `summarize` で PDF の概要を把握
2. `inspect_tags` でタグ構造を確認
3. pdf-spec-mcp の `get_requirements` で PDF/UA 要件を取得
4. `validate_tagged` で適合性を検証

## ライセンス

MIT
