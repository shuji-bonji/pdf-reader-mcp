# family 共通実装規約への整合 — pdf-reader-mcp

**作成日**: 2026-07-17
**規約本体**: `Document-Note/mcps/PDFfamily/specs/06-family-implementation-standards.md`
**関連**: `docs/TASKS.md`（A-1〜A-3 / B 系と重複するものは相互参照）

## 現状の準拠状況

reader は family の**参照実装に最も近い**。McpServer + registerTool + zod、tool annotations、
stdout ガード、絶対パス強制・`..` 拒否、構造化エラー（houki-hub family 語彙 =
`familyCode` / `next_actions` / `retryable` / `hint`）まで準拠済み。

## 残タスク（優先度順）

1. **Biome 版の三者不整合の解消**（= TASKS.md A-1）
   `package.json` の `^2.3.14` × 実体 2.5.3 × `biome.json` schema 2.3.14。
   family 標準は **2.5.4 完全固定**（キャレット禁止）。writer / verify は対応済みで、
   reader だけが未固定。

2. **`validate_tagged` / `validate_metadata` の deprecation 予告**（= 役割分担提案 M-2）
   判定責務は verify（`validate_conformance` の pdfua flavour）へ移管済み。
   description に deprecation と移行先を明記 → CHANGELOG 記録 → 次メジャーで削除。
   `inspect_tags` / `inspect_signatures` など**事実報告系は残す**（境界ルール:
   観測 = reader、合否 = verify）。

3. **ルート散乱物の整理**（= TASKS.md A-3）
   `repro-*.mjs/ts`、`repro-encrypted.pdf`（225KB）、`gen-twocol.mjs`、検証レポート md。
   `scripts/` / `tests/fixtures/` へ移動または削除。

4. **README の npx 表記**（= TASKS.md A-2）
   インストール例に `@latest` を付ける（規約 §2.8）。

## 出力パイプライン（pdf-publish Skill）での役割

`specs/07-pdf-publish-skill.md` にて、reader は writer 生成物の**読み戻し（Phase 2）**を担う。
必要になるのは既存ツール（`read_text` / `inspect_fonts` / `inspect_tags` / `get_metadata`）のみで、
**新規実装は不要**。ただし以下は将来の制約として記録する:

- 暗号化 PDF は非対応（`ENCRYPTED_PDF` を返すのみ）。publish ループでは扱わない前提でよいが、
  trust skill 側はパスワード対応を期待しており、対応するなら独立タスクとして起こす
- `validate_tagged` の廃止後も、`inspect_tags`（観測）は publish の読み戻しで使い続ける

## バグ（2026-07-17・pdf-publish ドライランで発見）

- **`inspect_fonts` が Type0 (CIDFont) の埋め込みを "Embedded: No" と誤報告する**。
  埋め込みフォントの FontFile3 は DescendantFont 側の FontDescriptor にあるが、
  検査がトップレベルの Font 辞書しか見ていない模様。実測: pdf-writer-mcp v0.8.0 の
  埋め込みサブセット（Type0 / Identity-H / CIDFontType0）に No が返る一方、
  veraPDF の 7.21.4.1（フォント埋め込み）は COMPLIANT。
  修正: Type0 の場合は /DescendantFonts[0]/FontDescriptor の FontFile / FontFile2 /
  FontFile3 を見る。subset 判定（`ABCDEF+` 接頭辞）も同様の場所
