---
spec_id: READER
kind: common
introduced_by: remove-validate-tools
---
# tools-list Specification

## Purpose
pdf-reader-mcp が MCP の `tools/list` で返すツールの集合を定めます。個々のツールの入力と出力は各ツールの capability に書き、ここには「どのツールがあるか」と「どのツールを置かないか」だけを書きます。

## Requirements

### Requirement: SPEC-READER-TOOLS-LIST-001 tools/list は 18 ツールを返す

`tools/list` の応答は、次の 18 ツールをちょうど返す（SHALL）。増やす・減らすときは、この要求を MODIFIED で書き換える。

- 基本: `read_text`・`read_url`・`read_images`・`render_page`・`search_text`・`get_metadata`・`get_page_count`・`summarize`
- 構造: `inspect_structure`・`inspect_catalog`・`inspect_fonts`・`inspect_annotations`・`inspect_signatures`・`inspect_tags`・`extract_tables`・`extract_structured_text`・`locate_objects`
- 比較: `compare_structure`

#### Scenario: tools/list の名前の集合が 18 ツールと一致する
- **WHEN** サーバーに `tools/list` を送る
- **THEN** 返るツールの名前の集合は上の 18 個と一致し、重複が無い

#### Scenario: 削除した 2 ツールは tools/list に無い
- **WHEN** サーバーに `tools/list` を送る
- **THEN** `validate_tagged` と `validate_metadata` はどちらも含まれない

### Requirement: SPEC-READER-TOOLS-LIST-002 規格に照らした合否を返すツールを登録しない

本サーバは観測を返すだけで、ISO 規格に照らした合否（compliant / valid / pass-fail）を返すツールを登録しない（SHALL）。名前が `validate_` で始まるツールを登録しない（SHALL）。合否は pdf-verify-mcp（`validate_conformance` など）が返す。

#### Scenario: validate_ で始まるツールが無い
- **WHEN** サーバーに `tools/list` を送る
- **THEN** 名前が `validate_` で始まるツールは 1 つも無い
