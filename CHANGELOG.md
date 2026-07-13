# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.3] - 2026-07-14

### Added

- **Claude Code plugin 対応** — `.claude-plugin/plugin.json` を追加。Claude Code の plugin として直接インストールできるようになりました。`mcpServers` エントリは `npx -y @shuji-bonji/pdf-reader-mcp@latest` を起動します。shuji 製 MCP 群 (epsg-mcp / houki-egov-mcp / pdf-spec-mcp / pdf-verify-mcp 等) の plugin.json と同じ構造に揃えてあります。
- **README に PDF family セクションを追加** (README.md / README.ja.md) — `pdf-spec-mcp` (仕様知識) / `pdf-reader-mcp` (構造の読取・検査) / `pdf-verify-mcp` (真正性検証) の役割分担を明示。`inspect_signatures` が署名の**構造**のみを検査し、**暗号学的**な署名検証・信頼/失効評価・PDF/A 準拠検証は `pdf-verify-mcp` の担当であることを追記しました。

### Fixed

- **`SERVER_VERSION` の version drift を解消**。0.6.2 リリース時に `src/constants.ts` の `SERVER_VERSION` が `0.6.1` のまま取り残されており、MCP handshake の `serverInfo.version` と `read_url` の `User-Agent` が実際のパッケージバージョンより古い値を報告していました。`createRequire` で `package.json` から動的に読むように変更し (shuji-mcp-patterns Pattern B: ESM での動的バージョン取得)、以後リリースのたびに手で同期する必要はありません。

## [0.6.2] - 2026-05-09

### Build

- **build script に `chmod +x dist/index.js` を追加**: local dev で `./dist/index.js` を直接実行した際の `permission denied` を回避。npm install / npx 経由の通常利用には影響なし (npm が install 時に bin を chmod するため)。shuji 製 MCP 全体で build script を統一。

## [0.6.1] - 2026-05-08

### Added

- **`read_url` の同時実行数制限 (concurrency limit)** — module-level の shared limiter を `src/services/url-fetcher.ts` に導入。LLM が複数 `read_url` を並列に呼んでも、リモートホストへの過剰負荷とレート制限の発火を防ぎます。
  - 新規 `src/utils/concurrency.ts`: 軽量な FIFO ベース limit ヘルパー (`createLimit`)。houki-egov-mcp v0.2.1 の同名実装を移植 (外部依存なし、約 30 行)。
  - 既定 4 並列。環境変数 `PDF_READER_CONCURRENCY` で上書き可。
  - `fetchPdfFromUrl(url)` は内部で limit を経由するように変更。limit を経由しない素の実装は `fetchPdfFromUrlUnlimited(url)` として再エクスポート (テスト・特殊用途用)。
- **`tests/tier1/concurrency.test.ts`**: limit が cap を超えないこと、戻り値・順序を保つこと、エラー伝播の単体テスト 5 件。

### Changed

- **`SERVER_VERSION` 定数を `0.6.0` → `0.6.1` へ同期**。`User-Agent` ヘッダで送信される値もこれに追従。

## [0.6.0] - 2026-05-07

### Added

- **houki-hub family-compatible 構造化エラー応答** (Issue #9): すべての tool がエラー時に `LawServiceError` を JSON 文字列化したものを `content[0].text` に入れ、`isError: true` を立てて返すように変更しました。`code` 文字列は houki-hub family (houki-egov-mcp / houki-nta-mcp) と語彙を共有するため、LLM や Skill 層が一貫した解釈ロジックでエラーを処理できます。
  - 新規 `src/errors.ts`: `LawErrorCode` / `LawServiceError` / `makeError` / `isLawServiceError` / `NEXT_ACTIONS` を定義 (houki-egov-mcp の `src/errors.ts` をリファレンスとし、`houki-abbreviations` 等への依存はなし)。
  - 新規 `handleStructuredError(error)`: `unknown` を `LawServiceError` に正規化。`PdfReaderError` の legacy `code` を family 語彙にマッピング、汎用 `Error` のメッセージから `DOC_NOT_FOUND` / `INVALID_PDF` / `ENCRYPTED_PDF` / `FILE_TOO_LARGE` / `SOURCE_*` を推定。
  - 採用 `code` 一覧: `INVALID_ARGUMENT` / `DOC_NOT_FOUND` / `INVALID_PDF` / `ENCRYPTED_PDF` / `UNSUPPORTED_PDF_FEATURE` / `FILE_TOO_LARGE` / `SOURCE_API_ERROR` / `SOURCE_TIMEOUT` / `SOURCE_UNAVAILABLE` / `INTERNAL_ERROR`。
  - `PdfReaderError` を拡張: 直接 `familyCode` / `nextActions` / `retryable` / `detail` を渡せる第 4〜7 引数を追加 (既存呼び出しは変更なし、後方互換)。
- **`tests/tier1/errors.test.ts`**: makeError / isLawServiceError / NEXT_ACTIONS / handleStructuredError の単体テストを追加 (28 ケース)。

### Changed

- **全 16 tool のエラーパス**: tier1 (7) / tier2 (6) / tier3 (3) すべてが `handleStructuredError(error)` を呼び、JSON 文字列 + `isError: true` を返す形に統一。`content[0].text` は人間可読文字列ではなく **JSON** になります。
- **README.md / README.ja.md** の Error Contract セクション: 「方針」記述を「v0.6.0 で実装済み」に更新し、`code` 一覧テーブル / 移行ノート (v0.5.x → v0.6.0) を追記。
- **`handleError(error)` (deprecated)**: 後方互換のため引き続き人間可読な文字列を返しますが、内部実装は `formatStructuredErrorForHumans(handleStructuredError(error))` に置き換わりました。新規 tool では `handleStructuredError()` を直接利用してください。

### Migration

LLM クライアントや Skill 層で `content[0].text` を文字列として解釈していた場合、v0.6.0 以降は `JSON.parse(content[0].text)` で `LawServiceError` として解釈してください。`isError: true` フラグで構造化エラーかどうかを判定できます。詳細は README の「Error Contract (houki-hub family)」セクションを参照。

## [0.5.0] - 2026-05-07

### Added

- **`compact_whitespace` parameter on `read_text` and `read_url`** (Issue #4): opt-in whitespace normalization that collapses runs of `\s` plus U+3000 (fullwidth space) to a single ASCII space, and trims every line. Designed for Japanese form-style PDFs (帳票・様式) where U+3000 is used as visual indentation, inflating token consumption without adding information.
  - Default `false` keeps the existing extraction byte-for-byte (regression-tested).
  - Combines orthogonally with `split_columns`: inter-column `\n\n` separators survive the compaction.
  - Per-cell CJK kerning ("消 費 税" → "消費税") is intentionally NOT touched here — that requires CJK-aware logic and remains the responsibility of `extract_tables`'s `compactCellText`.
  - Empirically reduces character count by ~40% on 国税庁 form PDFs (e.g. `jimu-unei/hojin/090401-2/pdf/01.pdf`) while preserving all content.
- **E2E tests** in `tests/e2e/02-tier1-text.test.ts`: 3 new cases (RT-CW-1..3) covering the regression guard, the line-trim + run-collapse invariants, and orthogonal combination with `split_columns`.

### Changed

- **`read_text` / `read_url` tool descriptions**: documented the new `compact_whitespace` parameter and added "Japanese form template" usage example.

## [0.4.0] - 2026-05-07

### Added

- **`split_columns` parameter on `read_text` and `read_url`** (Issue #3): opt-in column-aware reordering for **untagged** multi-column PDFs. When `split_columns: 2` (or `3`) is passed, text items are first bucketed by X-coordinate into N equal-width columns, then each bucket is Y-sorted independently and concatenated left-to-right with a blank-line separator. Designed for older 新旧対照表 PDFs and similar two-column documents that lack a structure tree (Tagged PDFs with proper `<Table>` markup should use `extract_tables` instead).
  - `splitColumns: 1` (default / undefined) is unchanged — existing single-column Y-sort behaviour is preserved as a regression-tested baseline.
  - `extractText` / `extractTextFromDoc` now accept an `ExtractTextOptions` object with `splitColumns?: number`. Internally, line-grouping logic is factored out into `itemsToText` so the column path reuses the same Y-sort.
- **Test fixture `tests/fixtures/two-column.pdf`**: 1-page A4 untagged PDF with `LEFT-1..4` and `RIGHT-1..4` placed at paired Y-coordinates so plain Y-sort interleaves them — the regression target for `split_columns`.
- **E2E tests** in `tests/e2e/02-tier1-text.test.ts`: 4 new cases (RT-SC-1..4) covering the failure mode without `split_columns`, the success mode with `split_columns: 2`, the `split_columns: 1` regression guard, and a sanity check that `split_columns: 2` on a single-column PDF preserves all content.

### Changed

- **`read_text` / `read_url` tool descriptions**: documented the new `split_columns` parameter with guidance to prefer `extract_tables` for Tagged PDFs.

## [0.3.0] - 2026-05-06

### Added

- **`extract_tables` (Tier 2)**: New tool that walks a Tagged PDF's structure tree and emits every `<Table>` subtree as a Markdown table or a JSON document. Designed for documents whose meaning depends on multi-column layout — e.g. 国税庁 新旧対照表 (kaisei tsutatsu) PDFs where reading-order extraction merges 改正後 / 改正前 columns into ambiguous text. Internals:
  - `extractTables(filePath, pages?)` / `extractTablesFromDoc(doc, pages?)` in `services/pdfjs-service.ts`. Walks the StructTree, identifies `<Table>` → `<THead> | <TBody> | <TFoot>` → `<TR>` → `<TH> | <TD>`, then resolves cell text by mapping each leaf node's marked-content `id` (e.g. `p715R_mc4`) to the corresponding `beginMarkedContentProps` boundary in `getTextContent({ includeMarkedContent: true })`.
  - Cell text post-processing: collapses whitespace runs (incl. U+3000), folds per-character kerning runs ("消 費 税 法" → "消費税法") while preserving natural inter-word spacing ("事業者 法人番号"), escapes Markdown table delimiters.
  - Untagged PDFs return `isTagged: false`, an empty `tables` array, and a `note` recommending column-aware extraction (planned in Issue #3) as the fallback.
  - colspan / rowspan and nested tables are skipped in this initial release; cells appear in source order.
- **Types**: `TableCell`, `TableRow`, `ExtractedTable`, `TablesExtractionResult` in `types.ts`.
- **Schema**: `ExtractTablesSchema` in `schemas/tier2.ts` (file_path + pages + response_format).
- **Markdown formatter**: `formatTablesMarkdown` in `utils/formatter.ts` renders results as `# Extracted Tables` summary block followed by `## Page N — Table M` GFM tables.
- **E2E tests**: 5 new tests in `tests/e2e/04-tier2-structure.test.ts` covering untagged → note path, tagged-but-empty path, formatter shape, and pages filter.

### Changed

- **Tool count**: 15 → 16 tools (Tier 2 now has 6).
- README / README.ja.md tool tables and architecture diagram updated accordingly.

## [0.2.3] - 2026-05-06

### Fixed

- **`inspect_structure` / `inspect_fonts`**: No longer throw `Expected instance of PDFDict, but got instance of undefined` on Linearized PDFs whose cross-reference cannot be fully resolved by pdf-lib. Public-sector publishers (e.g. Japanese government agencies) routinely emit Linearized PDFs from Microsoft Word; previously every such file produced a hard error. After the fix:
  - `analyzeStructure` returns a partial result. The page count is filled in via pdfjs-dist when pdf-lib's page-tree traversal fails, and a `note` field describes the fallback.
  - `analyzeFontsWithPdfLib` returns an empty font map with an explanatory `note` instead of throwing.
  - All pdf-lib call sites (`loadWithPdfLib`, `analyzeStructure`, `analyzeFontsWithPdfLib`, `analyzeSignatures`, `detectEncryption`) now run inside `withSuppressedPdfLibLogs`, preventing pdf-lib's `console.log`-based parse diagnostics from polluting the JSON-RPC stream when the server runs over stdio.
- **Types**: `StructureAnalysis` and `FontsAnalysis` gained an optional `note?: string` field. `FontAnalysisResult` (internal) gained the same field.
- **Markdown formatter**: `formatStructureMarkdown` and `formatFontsMarkdown` now render the `note` as a `> ...` blockquote when present.

### Added

- **Test fixture**: `tests/fixtures/linearized.pdf` (regenerated by `create-test-pdf.ts` via `qpdf --linearize`) and matching e2e regression tests in `tests/e2e/04-tier2-structure.test.ts`.

## [0.2.2] - 2026-04-18

### Fixed

- **README**: Fixed broken link to pdf-spec-mcp. The `nicholasgriffintn/pdf-spec-mcp` URL in previous versions was erroneous (that repository does not exist); now correctly points to [`shuji-bonji/pdf-spec-mcp`](https://github.com/shuji-bonji/pdf-spec-mcp) — the companion MCP server providing ISO 32000 PDF specification knowledge.
- Restored the "Pairing with pdf-spec-mcp" section in both `README.md` and `README.ja.md` with the corrected link.
- **`src/index.ts`**: Restored header comment describing pairing with pdf-spec-mcp.

## [0.2.1] - 2026-04-18

### Changed

- **CI/CD**: Migrated npm publish workflow to [Trusted Publishing (OIDC)](https://docs.npmjs.com/trusted-publishers). `NPM_TOKEN` is no longer required; provenance attestations are generated automatically.
- **Publish workflow**: Split into `test` / `build` / `publish` jobs with tag-vs-`package.json` version consistency check.
- **`package.json`**: Added `publishConfig.access: "public"`, `publishConfig.provenance: true`, and `prepublishOnly: "npm run build"` for publish safety.
- **README**: Synchronized `README.ja.md` with `README.md` (`npx`-based installation steps). Corrected test counts (unit: 39, E2E: 118, total: 157).

## [0.2.0] - 2026-02-08

### Added

- **Tier 3 tools**: `validate_tagged`, `validate_metadata`, `compare_structure`
- **E2E test suite**: 146 tests across 9 test suites with performance baseline tracking
- **CI/CD**: GitHub Actions workflow for automated testing (Node 18/20/22) and npm publishing
- **Batch processor utility**: `processInBatches()` and `processAndReduce()` for large PDF handling
- **`analyzeTagsFromDoc()`**: Pre-loaded document variant for shared document lifecycle

### Changed

- **Parallel page processing**: `extractTextFromDoc`, `searchText`, `countImagesFromDoc`, `extractImages`, `checkSignatures`, `analyzeAnnotations`, `analyzeTags` now use `Promise.all` for concurrent page access
- **`validateTagged()`**: Eliminated double document load — now loads once and runs `analyzeTagsFromDoc` + `countImagesFromDoc` in parallel via `Promise.all`
- **Test infrastructure**: Extracted constants (`constants.ts`), cached baseline reads, added `measureAndCheck()` helper for DRY performance tests
- **Test naming**: All test descriptions translated to English for international readability

### Performance

- `searchText`: ~68% faster (parallel text extraction across pages)
- `getMetadata`: ~27% faster (parallel signature check)
- `validateMetadata`: ~25% faster
- `analyzeFonts`: ~57% faster
- `getMetadata-all-7` (batch): ~17% faster

## [0.1.0] - 2026-02-07

### Added

- **Tier 1 tools** (7): `get_page_count`, `get_metadata`, `read_text`, `search_text`, `read_images`, `read_url`, `summarize`
- **Tier 2 tools** (5): `inspect_structure`, `inspect_tags`, `inspect_fonts`, `inspect_annotations`, `inspect_signatures`
- Input validation with Zod schemas and path security checks
- Y-coordinate-based text extraction preserving natural reading order
- Unit tests for core utilities and pdfjs-service

[0.5.0]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/shuji-bonji/pdf-reader-mcp/releases/tag/v0.1.0
