# PDF Reader MCP Server

[![npm version](https://img.shields.io/npm/v/@shuji-bonji/pdf-reader-mcp)](https://www.npmjs.com/package/@shuji-bonji/pdf-reader-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-blueviolet?logo=anthropic)](https://claude.ai/code)

**English** | [日本語](./README.ja.md)

An MCP (Model Context Protocol) server specialized in **deciphering PDF internal structures**.

While typical PDF MCP servers are thin wrappers for text extraction, this project focuses on **reading and analyzing the internal structure** of PDF documents. Pair it with [pdf-spec-mcp](https://github.com/nicholasgriffintn/pdf-spec-mcp) for specification-aware structural analysis and validation.

## Features

**15 tools** organized into three tiers:

### Tier 1: Basic Operations

| Tool             | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `get_page_count` | Lightweight page count retrieval                         |
| `get_metadata`   | Full metadata extraction (title, author, PDF version...) |
| `read_text`      | Text extraction with Y-coordinate reading order          |
| `search_text`    | Full-text search with surrounding context                |
| `read_images`    | Image extraction as base64 with metadata                 |
| `read_url`       | Fetch and process remote PDFs from URLs                  |
| `summarize`      | Quick overview report (metadata + text + image count)    |

### Tier 2: Structure Inspection

| Tool                  | Description                                      |
| --------------------- | ------------------------------------------------ |
| `inspect_structure`   | Object tree and catalog dictionary analysis      |
| `inspect_tags`        | Tagged PDF structure tree visualization          |
| `inspect_fonts`       | Font inventory (embedded/subset/type detection)  |
| `inspect_annotations` | Annotation listing (categorized by subtype)      |
| `inspect_signatures`  | Digital signature field structure analysis        |

### Tier 3: Validation & Analysis

| Tool                | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `validate_tagged`   | PDF/UA tag structure validation (8 checks)           |
| `validate_metadata` | Metadata conformance checking (10 checks)            |
| `compare_structure` | Structural diff between two PDFs (properties + fonts)|

## Installation

### npx (recommended)

```bash
npx @shuji-bonji/pdf-reader-mcp
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

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

## Tech Stack

- **TypeScript** + MCP TypeScript SDK
- **pdfjs-dist** (Mozilla) — text/image extraction, tag tree, annotations
- **pdf-lib** — low-level object structure analysis
- **Vitest** — unit + E2E testing (185 tests)
- **Biome** — linting + formatting
- **Zod** — input validation

## Testing

```bash
npm test              # Run all tests (unit + E2E)
npm run test:e2e      # E2E tests only (146 tests)
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
│   │   ├── tier2/            # Structure inspection (5)
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
    └── e2e/                  # E2E tests (9 suites, 146 tests)
```

## Pairing with pdf-spec-mcp

[pdf-spec-mcp](https://github.com/nicholasgriffintn/pdf-spec-mcp) provides PDF specification knowledge (ISO 32000-2, etc.). With both servers enabled, an LLM can perform specification-aware workflows:

1. `summarize` — get a PDF overview
2. `inspect_tags` — examine the tag structure
3. pdf-spec-mcp `get_requirements` — fetch PDF/UA requirements
4. `validate_tagged` — check conformance
5. `compare_structure` — diff before/after fixes

## License

MIT
