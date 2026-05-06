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
import { extractTables } from '../../services/pdfjs-service.js';
import { handleError } from '../../utils/error-handler.js';
import { formatTablesMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerExtractTables(server: McpServer): void {
  server.registerTool(
    'extract_tables',
    {
      title: 'Extract Tables (Tagged PDF)',
      description: `Extract every \`<Table>\` subtree from a Tagged PDF as a structured row/cell list,
optionally rendered as Markdown tables.

How it works: walks the StructTree and pulls cell text for each \`<TR>\` →
\`<TH>/<TD>\`, then collapses kerning whitespace (e.g. "消 費 税 法" → "消費税法").
This sidesteps reading-order extraction's failure mode on multi-column tables
(typical of 新旧対照表 PDFs).

Args:
  - file_path (string): Absolute path to a local PDF file
  - pages (string, optional): Page range. Format: "1-5", "3", or "1,3,5-7". Omit for all pages.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Markdown — \`# Extracted Tables\` summary block followed by one
  \`## Page N — Table M\` section per table with a GFM table.

  JSON — \`{ isTagged, tables: [{ page, index, headerRows, bodyRows, footerRows }],
  totalTables, pagesScanned, note? }\`.

Limitations:
  - Untagged PDFs return an empty result and a \`note\`.
  - colspan/rowspan are not honoured (cells are listed in source order).
  - Nested tables are skipped to keep page indices stable.

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
        return { content: [{ type: 'text' as const, text: handleError(error) }] };
      }
    },
  );
}
