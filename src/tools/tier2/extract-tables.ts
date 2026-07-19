/**
 * extract_tables - Tagged PDF Table → Markdown extraction.
 *
 * Walks the structure tree (Tagged PDF only) and emits every `<Table>`
 * subtree as a Markdown table or a JSON object. Designed for documents
 * such as 国税庁 新旧対照表 / 帳票, where pure reading-order extraction
 * collapses two-column tables into ambiguous text.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type ExtractTablesInput, ExtractTablesSchema } from '../../schemas/tier2.js';
import { extractTables } from '../../services/struct-tree-service.js';
import { handleStructuredError } from '../../utils/error-handler.js';
import { formatTablesMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerExtractTables(server: McpServer): void {
  server.registerTool(
    'extract_tables',
    {
      title: 'Extract Tables (Tagged PDF)',
      description: `Extract every \`<Table>\` subtree from a Tagged PDF as a structured row/cell list,
optionally rendered as Markdown tables.

How it works: walks the document's StructTreeRoot depth-first (the same walker
as \`extract_structured_text\` / \`inspect_tags\`) and pulls cell text for each
\`<TR>\` → \`<TH>/<TD>\`, then collapses kerning whitespace (e.g. "消 費 税 法" →
"消費税法"). This sidesteps reading-order extraction's failure mode on
multi-column tables (typical of 新旧対照表 PDFs).

A Table that continues across a page break is ONE table (ISO 32000-2 §14.8.2.5
NOTE 2) — \`pages\` is an array, and a table touching the requested page range is
returned whole. Cell text honours \`/ActualText\` replacements (§14.9.4).

Args:
  - file_path (string): Absolute path to a local PDF file
  - pages (string, optional): Page range. Format: "1-5", "3", or "1,3,5-7". Omit for all pages.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Markdown — \`# Extracted Tables\` summary block followed by one
  \`## Table N — Page(s) …\` section per table with a GFM table.

  JSON — \`{ isTagged, tables: [{ pages, index, headerRows, bodyRows, footerRows }],
  totalTables, pagesScanned, note? }\`. \`index\` is the table's 1-based position
  in logical content order, document-wide.

Limitations:
  - Untagged PDFs return an empty result and a \`note\`.
  - colspan/rowspan are not honoured (cells are listed in source order).
  - Nested tables are not emitted separately (their text appears in the outer cell).

Examples:
  - Pull 新旧対照表 from a kaisei tsutatsu PDF for diffing
  - Convert 帳票 (form template) tables into structured data`,
      inputSchema: ExtractTablesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ExtractTablesInput) => {
      try {
        const result = await extractTables(params.file_path, params.pages);
        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(result, null, 2)
            : formatTablesMarkdown(result);

        const { text } = truncateIfNeeded(raw);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const err = handleStructuredError(error);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(err, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
