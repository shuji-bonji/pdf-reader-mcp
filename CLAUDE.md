# pdf-reader-mcp - 開発ガイド

## プロジェクト概要

PDF の中身を**読み取り・報告**する MCP サーバ。PDF family における「**実体**」担当。

| 層 | サーバ | 一行定義 |
|----|--------|----------|
| 正典 | [pdf-spec-mcp](https://github.com/shuji-bonji/pdf-spec-mcp) | 仕様は何を要求するか |
| **実体** | **本サーバ** | **中身に何があるか（合否は言わない）** |
| 判定 | [pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp) | それは本物で、規格に適っているか |
| 生成 | [pdf-writer-mcp](https://github.com/shuji-bonji/pdf-writer-mcp) | 仕様どおりに書けるか |

- 残タスク: [`docs/TASKS.md`](./docs/TASKS.md)
- 責務分担の提案: `mcps/pdf-family-role-architecture.md`
- 上位仕様: `Document-Note/mcps/PDFfamily/foundation/pdf-reader-mcp.md`

## ツール一覧（16・3 tier）

| Tier | ツール |
|------|--------|
| 1 基本 | `read_text` / `read_url` / `read_images` / `search_text` / `get_metadata` / `get_page_count` / `summarize` |
| 2 構造検査 | `inspect_structure` / `inspect_fonts` / `inspect_annotations` / `inspect_signatures` / `inspect_tags` / `extract_tables` |
| 3 検証・分析 | `compare_structure` / `validate_metadata` / `validate_tagged` |

## 境界ルール（ツール追加時の判断基準）

> **ISO 規格等に照らした compliant / valid / pass-fail を返すなら pdf-verify-mcp、
> 観測結果を返すだけなら本サーバ。**

本サーバは「何があるか」を報告する。「それでいいのか」は判定せず、利用者（LLM）に委ねる。

- `inspect_signatures` は署名フィールドの**存在**を報告する（暗号検証は verify の `verify_signatures`）
- `inspect_tags` は構造ツリーを**報告**する（PDF/UA 準拠の判定は verify の `validate_conformance`）

⚠️ **Tier 3 の `validate_tagged` / `validate_metadata` はこの規則の例外**（verify が存在しなかった
時代の実装）。pdf-verify-mcp v0.6.0 が PDF/UA 判定を実装したため、**責務としては移管済み**。
詳細は `docs/TASKS.md` の M-2。新しい `validate_*` をここに足さないこと。

## アーキテクチャの要点

```
index.ts → tools/{tier1,tier2,tier3}/*.ts（zod スキーマ + ハンドラ）
  services/pdfjs-service.ts  : pdfjs 依存（構造ツリー・オペレータリスト）
  services/pdflib-service.ts : pdf-lib 依存（辞書レベル）
  utils/formatter.ts         : markdown 化
```

- ツール追加は該当 tier に 1 ファイル + 登録
- `console.log` 禁止（MCP の stdio を汚染する）。ログは stderr へ

## 落とし穴

### 1. pdfjs 依存はこのサーバの固有資産

`analyzeTagsFromDoc`（構造ツリー）や `countImagesFromDoc`（`getOperatorList` +
`OPS.paintImageXObject`）は pdfjs に依存する。verify は意図的に pdfjs を持たない
（pdf-lib + pkijs のみ）ため、**pdfjs が要る検査はここでしかできない**。
これは弱点ではなく役割分担。

### 2. `validate_tagged` の構造ツリーは合成物

ページごとに `page.getStructTree()` を呼んで `roleCounts` をマージしている。
StructTreeRoot を直接読んでいないため、`rootTag` は疑似ノード。
「StructTreeRoot はあるがページに紐づかない」ケースは検出できない
（verify は catalog を直接見るのでこちらは検出できる）。

### 3. `validate_tagged` は alt text の**存在**を見ていない

Figure タグの**個数**しか数えておらず、`/Alt` 属性そのものは検証していない
（コード上も "potential alt text" 止まり）。verify の `ua-figure-alt` は実在を検証する。
この差は M-2 の移管理由のひとつ。

### 4. biome の版はキャレット指定のまま（要対応）

`package.json` は `^2.3.14` だが実体は 2.5.3、`biome.json` の `$schema` は 2.3.14。
**biome は minor 更新で整形結果が変わる**ため、手元の `npm install` が CI より先に進むと
誰も触っていないファイルに差分が出る（verify で実際に発生した）。
現状 2.5.3 では整形は無事だが、次の minor で再発しうる。`docs/TASKS.md` の A-1 を参照。

## テスト

```bash
npm test           # vitest
npm run test:e2e   # E2E（別 config）
npm run check      # biome（lint + format）
npm run typecheck
```

## リリース

1. `package.json` の version を上げる
2. `CHANGELOG.md` に追記（英語）
3. コミット → push
4. `git tag vX.Y.Z && git push origin vX.Y.Z` → publish workflow が Trusted Publisher (OIDC) で公開

## ドキュメント方針

- `README.md` = **英語**（メイン）、`README.ja.md` = 日本語。両者を同時に更新する
- `CHANGELOG.md` = 英語
- できないこと・精度の限界（テキストフォールバック時など）を隠さず明記する
