/**
 * read_text - Text extraction with Y-coordinate-based reading order.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type ReadTextInput, ReadTextSchema } from '../../schemas/tier1.js';
import { extractText } from '../../services/pdfjs-service.js';
import { handleStructuredError } from '../../utils/error-handler.js';
import { formatPageTextsMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerReadText(server: McpServer): void {
  server.registerTool(
    'read_text',
    {
      title: 'Read PDF Text',
      description: `Extract text content from a PDF document with Y-coordinate-based reading order preservation.

Text is extracted page by page, sorted by vertical position (top to bottom) then horizontal position (left to right), providing natural reading order.

\`/ActualText\` replacements (ISO 32000-2 §14.9.4) are resolved, on both of the paths that clause defines: the \`/ActualText\` of a structure element, and the one in a \`Span\` marked-content property list — the latter occurs in untagged documents too. So a word carried as ActualText (ligature substitutes, hyphenation fixes) reads here the way a person viewing the page sees it, not in its glyph form.

For **tagged** PDFs, \`extract_structured_text\` is still the better tool when order matters: it returns text in logical content order (ISO 32000-2 §14.8.2.5), which this tool does not — read_text sorts by coordinate. Tables in tagged PDFs are best read with \`extract_tables\`.

For **untagged** multi-column PDFs (e.g. older 新旧対照表 PDFs that lack a structure tree), pass \`split_columns: 2\` or \`3\` to bucket items by X-coordinate left-to-right.

For Japanese form-style PDFs (帳票・様式) where U+3000 fullwidth spaces are used as visual indentation, pass \`compact_whitespace: true\` to collapse runs of whitespace to a single ASCII space. Cuts 20–40% of token consumption without losing content.

Args:
  - file_path (string): Absolute path to a local PDF file
  - pages (string, optional): Page range to extract. Format: "1-5", "3", or "1,3,5-7". Omit for all pages.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')
  - split_columns (1 | 2 | 3, optional): Column-aware reordering for untagged multi-column PDFs. Default 1 = existing Y-sort.
  - compact_whitespace (boolean, optional): Collapse whitespace runs (incl. U+3000) to one ASCII space and trim each line. Default false.

Returns:
  Extracted text organized by page number. With \`split_columns >= 2\`, columns are separated by a blank line so a downstream LLM can tell them apart.

Examples:
  - Extract all text: { file_path: "/path/to/doc.pdf" }
  - Untagged 新旧対照表: { file_path: "/path/to/older-shinkyu.pdf", split_columns: 2 }
  - Japanese form template: { file_path: "/path/to/form.pdf", compact_whitespace: true }`,
      inputSchema: ReadTextSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ReadTextInput) => {
      try {
        const pages = await extractText(params.file_path, params.pages, {
          splitColumns: params.split_columns,
          compactWhitespace: params.compact_whitespace,
        });

        let text: string;
        if (params.response_format === ResponseFormat.JSON) {
          text = JSON.stringify(pages, null, 2);
        } else {
          text = formatPageTextsMarkdown(pages);
        }

        const { text: finalText } = truncateIfNeeded(text);

        return {
          content: [{ type: 'text' as const, text: finalText }],
        };
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
