# PDF Reader MCP Server

[![npm version](https://img.shields.io/npm/v/@shuji-bonji/pdf-reader-mcp)](https://www.npmjs.com/package/@shuji-bonji/pdf-reader-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-blueviolet?logo=anthropic)](https://claude.ai/code)

**English** | [日本語](./README.ja.md)

An MCP (Model Context Protocol) server specialized in **deciphering PDF internal structures**.

While typical PDF MCP servers are thin wrappers for text extraction, this project focuses on **reading and analyzing the internal structure** of PDF documents. Pair it with [pdf-spec-mcp](https://github.com/shuji-bonji/pdf-spec-mcp) for specification-aware structural analysis and validation.

### PDF family

| Server | Role |
|--------|------|
| [pdf-spec-mcp](https://github.com/shuji-bonji/pdf-spec-mcp) | PDF specification knowledge (ISO 32000, PDF/A, PDF/UA) |
| **pdf-reader-mcp** (this) | Read and inspect PDF internal structure — *what is in* a PDF |
| [pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp) | Authenticity verification — *whether it is genuine*: cryptographic signature verification, tamper detection, PAdES level, PDF/A validation, encrypted-PDF decryption |

`pdf-reader-mcp` inspects signature **structure** (`inspect_signatures`); for **cryptographic** signature verification, trust/revocation evaluation, and PDF/A conformance validation, use `pdf-verify-mcp`.

## Features

**19 tools** organized into three tiers:

### Tier 1: Basic Operations

| Tool             | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `get_page_count` | Lightweight page count retrieval                         |
| `get_metadata`   | Full metadata extraction (title, author, PDF version...) |
| `read_text`      | Text extraction with Y-coordinate reading order (opt-in `split_columns: 2 \| 3` for untagged multi-column PDFs, `compact_whitespace` for Japanese forms). Resolves `/ActualText` replacements (§14.9.4, both the structure-element and the `Span` marked-content path). Reports **text extractability** per page (§9.10.1) so an empty result is never mistaken for an empty page. For **logical** order in tagged PDFs, prefer `extract_structured_text` |
| `search_text`    | Full-text search with surrounding context. Searches the same text `read_text` returns, `/ActualText` included, so a hit means what a reader sees (a `note` names any page whose marked content could not be aligned) |
| `read_images`    | Embedded image XObjects as **PNG or JPEG files**, returned as MCP image content blocks so a vision model can read them. `max_width` / `max_height` downscale by area average; the response has a byte budget and names anything it leaves out |
| `read_url`       | Fetch and process remote PDFs from URLs                  |
| `render_page`    | Rasterise pages to **PNG/JPEG** via PDFium-WASM (optional dependency `@hyzyla/pdfium`). The next step when text extractability says `no_text_layer` / `not_extractable` — draws the whole page, vector art and forms included |
| `summarize`      | Quick overview report (metadata + text + image count + per-document text extractability) |

### Tier 2: Structure Inspection

| Tool                  | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `inspect_structure`   | Object tree and catalog dictionary analysis                         |
| `inspect_tags`        | Tagged PDF structure tree visualization                             |
| `inspect_fonts`       | Font inventory (embedded/subset/type detection)                     |
| `inspect_annotations` | Annotation listing (categorized by subtype)                         |
| `inspect_signatures`  | Digital signature field structure analysis                          |
| `extract_structured_text` | Tagged PDF text in **logical content order** (ISO 32000-2 §14.8.2.5), each piece labelled with its structure type (`H1` / `P` / `Table` …). Resolves `/ActualText`, separates `/Alt` and list labels, keeps page-spanning elements whole. `include_bbox: true` adds **where each element is drawn** — one rectangle per page, in the form `add_annotation` takes |
| `extract_tables`      | Tagged PDF `<Table>` subtree → Markdown table (preserves columns). A table continuing across a page break is ONE table (`pages` array) |
| `locate_objects`      | Object number → page and rectangle, in the coordinate form [pdf-writer-mcp](https://github.com/shuji-bonji/pdf-writer-mcp) `add_annotation` takes. Bridges [pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp) `verify_integrity`'s "which objects changed" to "where they are". Each location names its `basis`: an annotation's own `/Rect` is exact, a content stream can only say "the whole page" |

### Tier 3: Validation & Analysis

| Tool                | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `validate_tagged`   | **Deprecated** — PDF/UA pass/fail belongs to [pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp) `validate_conformance` (`flavour: "pdfua-1"`). Kept until the next major |
| `validate_metadata` | **Deprecated** — same migration path as above. Kept until the next major |
| `compare_structure` | Structural diff between two PDFs (properties + fonts)|

### Pages can be rendered when text cannot be read (#23)

`summarize` reporting `hasText: false` used to be a dead end: nothing in this server could
read the document any further. `render_page` closes that — it rasterises pages to PNG or JPEG
and returns them as MCP image content blocks, so a vision model can read a scan, a diagram, a
filled form, or handwriting.

```
render_page({ file_path: "/path/to/scan.pdf", pages: "1-3", format: "jpeg" })
```

`pages` is required: rendering is the most expensive operation here, and "all pages" of a
500-page scan should be a decision, not a default. The same 4 MB response budget as
`read_images` applies, with omissions named.

Rendering runs on **PDFium compiled to WebAssembly** (`@hyzyla/pdfium`, an optional
dependency). A WASM binary is the same bytes on every platform, so the published package still
behaves identically wherever `npx` runs it — the reason native addons are not used here.
Without the dependency installed, `render_page` reports what to install and every other tool
works normally. PDFium (BSD-3-Clause) is a different engine from the pdf.js this server reads
text with; the tool description says so, because a rendering difference between engines must
not be attributed to the file.

> Measured before choosing this: pdf.js + `@napi-rs/canvas` (1.0.7 and 0.1.80) segfaults the
> whole process on pages that draw images — exactly the pages this tool exists for — and
> renders blank pages when `standardFontDataUrl` is not configured.

### Images come back as image files (#22)

`read_images` used to base64 `imgData.data` — pdfjs's *decoded pixels*. An 8×8 RGB image was
192 bytes with no PNG or JPEG signature anywhere in it, so the result could not be opened by
any viewer and could not be read by a vision model, which is the reason to extract an image in
the first place.

Images are now encoded (PNG by default, lossless; `format: "jpeg"` with `quality` when smaller
matters) and returned as MCP `image` content blocks, with the metadata alongside in a text
block. Both encoders are written out here — no native addon, no per-platform binary.

The response is bounded at 4 MB of encoded image data. A 200 dpi A4 scan is ~11.6 MB of pixels
on its own, so images past the budget are **named with the reason** rather than dropped:

```
read_images({ file_path: "/path/to/scan.pdf", pages: "1", max_width: 1200, format: "jpeg" })
```

`read_images` returns the image XObjects a page draws. It is not a picture of the page — vector
drawings and text are not covered by it.

### Text extractability — three states, not two (#21)

`read_text` used to answer with text or with nothing, and nothing meant three different things.
ISO 32000-2 §9.10.1 separates them, so this server does too. Every text-returning tool —
`read_text`, `read_url`, `search_text`, `extract_structured_text`, `summarize` — reports, per
page:

| State | Condition | What to do next |
| --- | --- | --- |
| `extracted` | Every font used has a route to Unicode under §9.10.2 | Use the text |
| `no_text_layer` | No text-showing operator (`Tj` `TJ` `'` `"`), image content present | The page is pixels. OCR or a rendered image is needed; this server does neither |
| `not_extractable` | A font used has no `/ToUnicode`, no standard encoding and no known CID collection | Text is missing or wrong. The report names the fonts and the clause |
| `not_observed` | Encrypted, or the content stream could not be read | Nothing was measured. Not the same as "nothing is there" |

`not_extractable` is reported **per font**, so a page that mixes a readable font with an
unreadable one is a partial loss and says so, rather than passing as complete.

The observation is made from the file, not from pdf.js's output: pdf.js synthesises a
`toUnicode` map for every font it loads, so asking it whether a font has a `/ToUnicode` CMap
answers yes for fonts whose dictionary has none.

## Installation

### npx (recommended)

```bash
npx @shuji-bonji/pdf-reader-mcp@latest
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

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

> **Use `@latest`.** The `-y` flag in `npx -y <pkg>` only skips the install
> prompt — it does **not** check for updates. Without `@latest`, npx keeps
> running whichever version it cached the first time, so new releases never
> reach you. If you suspect you are on a stale version, run
> `rm -rf ~/.npm/_npx` and restart your client.

### Claude Code

```bash
claude mcp add pdf-reader-mcp -- npx -y @shuji-bonji/pdf-reader-mcp@latest
```

### From Source

```bash
git clone https://github.com/shuji-bonji/pdf-reader-mcp.git
cd pdf-reader-mcp
npm install
npm run build
```

## Usage Examples

### Get Page Count

```
get_page_count({ file_path: "/path/to/document.pdf" })
→ 42
```

### Search Text

```
search_text({
  file_path: "/path/to/spec.pdf",
  query: "digital signature",
  pages: "1-20",
  max_results: 10
})
→ Found 5 matches (page 3, 7, 12, 15, 18)
```

### Summarize

```
summarize({ file_path: "/path/to/document.pdf" })
→ | Pages | 42 |
  | PDF Version | 2.0 |
  | Tagged | Yes |
  | Signatures | No |
  | Images | 15 |
```

### Validate Tagged Structure (PDF/UA)

```
validate_tagged({ file_path: "/path/to/document.pdf" })
→ ✅ [TAG-001] Document is marked as tagged
  ✅ [TAG-002] Structure tree root exists
  ⚠️ [TAG-004] Heading hierarchy has gaps: H1, H3
  ❌ [TAG-005] Document has 3 image(s) but no Figure tags
```

### Validate Metadata

```
validate_metadata({ file_path: "/path/to/document.pdf" })
→ ✅ [META-001] Title: "Annual Report 2025"
  ⚠️ [META-002] Author is missing
  ✅ [META-006] PDF version: 2.0
```

### Compare Structure

```
compare_structure({
  file_path_1: "/path/to/v1.pdf",
  file_path_2: "/path/to/v2.pdf"
})
→ | Page Count  | 10 | 12 | ❌ |
  | PDF Version | 1.7 | 2.0 | ❌ |
  | Tagged      | true | true | ✅ |
```

### Extract Structured Text (Tagged PDF, logical order)

```
extract_structured_text({ file_path: "/path/to/report.pdf", pages: "1-2" })
→ # Structured Text
  - **Tagged**: Yes / **Language**: en-US / **Elements**: 7

  ## Logical Content Order

  - **Document** (pages 1–2)
    - **H1** (page 1) — Quarterly Report
    - **P** (pages 1–2) — This paragraph begins on page one and continues on page two.
    - **Table** (page 1)
      | Item | Amount |
      |---|---|
      | Sales | 100 |
    - **Figure** (page 2) — *alt:* A bar chart of sales
```

This answers "what is the text of the H1?" — which `read_text` (flat,
coordinate order) cannot. Order is a depth-first traversal of the structure
tree (ISO 32000-2 §14.8.2.5). `/ActualText` replaces the glyphs (§14.9.4),
`/Alt` stays out of the body text (§14.9.3), list labels are reported
separately, and an element spanning a page break stays ONE element. Use
`roles: ["H1", "H2"]` to pull an outline. Untagged PDFs return
`isTagged: false` with a reason — nothing is guessed from coordinates.

#### `include_bbox`: where the element is drawn

```
extract_structured_text({ file_path: "/doc.pdf", roles: ["P"], include_bbox: true })
→ - **P** (page 1) — Measured paragraph
    - *bbox* p1 `(50.0, 297.5, 161.4, 308.6)` — text-extent
  - **Figure** (page 1)
    - *bbox* p1 `(50.0, 150.0, 110.0, 190.0)` — layout-attribute-bbox
```

Rectangles are in PDF default user space (origin bottom-left, pt, normalised) —
exactly what [pdf-writer-mcp](https://github.com/shuji-bonji/pdf-writer-mcp)
`add_annotation` takes, so "annotate this paragraph" needs no coordinate
conversion in between. `/Rotate` and a shifted `/CropBox` do not move them.

`basis` says how strong the claim is, and the two are different in kind:

| `basis` | What it is |
| --- | --- |
| `layout-attribute-bbox` | The `/BBox` the file **declares** (ISO 32000-2 Table 379), read through `/A` or `/C` + `/ClassMap`. A statement by the producer, reported as-is — and the only source for content that has no text |
| `text-extent` | **Measured** from the element's text: baseline origin plus the font's ascent/descent. The line box, not the glyph outlines. Images and vector art contribute nothing |

An element spanning pages gets ONE RECTANGLE PER PAGE — merging them would put
content on a page it is not on. An element with no rectangle says why in
`boxNote` rather than returning a zero-sized one.

**A declaration is reported as-is, and cross-checked.** Files state nonsense:
the cover `Figure` of *both* Well-Tagged PDF 1.0 and the Tagged PDF Best Practice
Guide declares `/BBox [-32768 -32768 32767 32767]` — int16 sentinels where a
rectangle should be — and PDF32000_2008 has 131 of its 545 declarations reaching
past the page edge. Since this output is meant to go straight into
`add_annotation`, a declaration is checked against the page box (§7.7.3.3) and
against the element's own text; either contradiction is reported in `boxNote`,
with the rectangle still returned unaltered.

Measured against independent ground truth: on *Well-Tagged PDF (WTPDF) 1.0*, the
166 `Link` structure elements were compared with the 173 `Link` **annotation**
`/Rect` values the producer placed for the same links — median IoU **0.972**,
none disjoint.

### Extract Tables (Tagged PDF)

```
extract_tables({ file_path: "/path/to/kaisei-tsutatsu.pdf", pages: "1" })
→ # Extracted Tables
  - **Tagged**: Yes / **Pages Scanned**: 1 / **Tables Found**: 1

  ## Table 1 — Page 1

  | 改正後 | 改正前 |
  | --- | --- |
  | …第２条第 16 項《定義》… | …第２条第 15 項《定義》… |
```

A table that continues across a page break is reported as ONE table —
`pages` is an array (e.g. `## Table 3 — Pages 5–7`), and a table touching
the requested `pages` range is returned whole. Cell text honours
`/ActualText` replacements (as do `read_text` and `search_text` since #18).
Untagged PDFs return an empty result with a
`note` recommending the column-aware fallback below.

### Read Untagged Multi-Column PDF

```
read_text({ file_path: "/path/to/older-shinkyu.pdf", split_columns: 2 })
→ // Plain Y-sort would interleave columns:
//   "改正後セル1   改正前セル1\n 改正後セル2   改正前セル2..."
//
// With split_columns: 2 the left column is emitted first, then the right:
//   "改正後セル1\n改正後セル2\n…\n\n改正前セル1\n改正前セル2\n…"
```

Use `split_columns: 2 | 3` for **untagged** multi-column PDFs. For Tagged
PDFs with proper `<Table>` markup, `extract_tables` (above) is preferred.

### Compact Whitespace (Japanese Forms)

```
read_text({ file_path: "/path/to/form.pdf", compact_whitespace: true })
→ // Original PDF uses U+3000 fullwidth space as visual indentation:
//   " (   )   自   年   月   日   法   有 （   年   月   日）   有   有"
//
// With compact_whitespace: true:
//   "( ) 自 年 月 日 法 有 （ 年 月 日） 有 有"
//
// Empirically reduces character count by ~40% on form PDFs.
```

`compact_whitespace` is orthogonal to `split_columns` — both can be combined.

## Tech Stack

- **TypeScript** + MCP TypeScript SDK
- **pdfjs-dist** (Mozilla) — text/image extraction, tag tree, annotations
- **pdf-lib** — low-level object structure analysis
- **Vitest** — unit + E2E testing (171 tests)
- **Biome** — linting + formatting
- **Zod** — input validation

## Testing

```bash
npm test              # Run all tests (unit: 39 tests)
npm run test:e2e      # E2E tests only (132 tests)
npm run test:watch    # Watch mode
```

## Architecture

```
pdf-reader-mcp/
├── src/
│   ├── index.ts              # MCP Server entry point
│   ├── constants.ts          # Shared constants
│   ├── types.ts              # Type definitions
│   ├── tools/
│   │   ├── tier1/            # Basic tools (7)
│   │   ├── tier2/            # Structure inspection (6)
│   │   ├── tier3/            # Validation & analysis (3)
│   │   └── index.ts          # Tool registration
│   ├── services/
│   │   ├── pdfjs-service.ts        # pdfjs-dist wrapper (parallel page processing)
│   │   ├── pdflib-service.ts       # pdf-lib wrapper
│   │   ├── validation-service.ts   # Validation & comparison logic
│   │   └── url-fetcher.ts          # URL fetching
│   ├── schemas/              # Zod validation schemas
│   └── utils/
│       ├── pdf-helpers.ts    # PDF utilities (page range parsing, file I/O)
│       ├── batch-processor.ts # Batch processing for large PDFs
│       ├── formatter.ts      # Output formatting
│       └── error-handler.ts  # Error handling
└── tests/
    ├── tier1/                # Unit tests
    └── e2e/                  # E2E tests (9 suites, 132 tests)
```

## Error Contract (houki-hub family)

Since **v0.6.0**, this MCP returns structured errors that follow the **houki-hub family error contract**, sharing a unified `code` vocabulary across the family. Combined with `houki-egov-mcp` / `houki-nta-mcp`, an LLM or Skill layer can interpret errors with consistent logic.

- [`docs/ERROR-CODES.md`](https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-CODES.md) — error code vocabulary (houki-research-skill)
- [`docs/ERROR-HANDLING.md`](https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-HANDLING.md) — handling policy / next_actions templates

Implementation is **independent** — no dependency on `houki-abbreviations` or other family packages. The reference implementation is [`houki-egov-mcp/src/errors.ts`](https://github.com/shuji-bonji/houki-egov-mcp/blob/main/src/errors.ts); pdf-reader-mcp's local definition is in [`src/errors.ts`](./src/errors.ts).

On error, every tool returns `isError: true` and the JSON-stringified `LawServiceError` in `content[0].text`:

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

### Codes used by pdf-reader-mcp

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

### Migration note (v0.5.x → v0.6.0)

旧 v0.5.x までは `content[0].text` に `Error: ...\n\nSuggestion: ...` という人間可読文字列を入れていました。v0.6.0 では同じ場所に **JSON 文字列** が入ります。LLM 側でテキスト解釈に依存していた場合は、`JSON.parse(content[0].text)` での解釈に切り替えてください。`isError: true` フラグで構造化エラーかどうかを判定できます。

## Pairing with pdf-spec-mcp

[pdf-spec-mcp](https://github.com/shuji-bonji/pdf-spec-mcp) provides PDF specification knowledge (ISO 32000-2, etc.). With both servers enabled, an LLM can perform specification-aware workflows:

1. `summarize` — get a PDF overview
2. `inspect_tags` — examine the tag structure
3. pdf-spec-mcp `get_requirements` — fetch PDF/UA requirements
4. `validate_tagged` — check conformance
5. `compare_structure` — diff before/after fixes

## License

MIT
