# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.2]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/shuji-bonji/pdf-reader-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/shuji-bonji/pdf-reader-mcp/releases/tag/v0.1.0
