/**
 * read_text - Text extraction with Y-coordinate-based reading order.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type ReadTextInput, ReadTextSchema } from '../../schemas/tier1.js';
import { extractText } from '../../services/pdfjs-service.js';
import { handleError } from '../../utils/error-handler.js';
import { formatPageTextsMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerReadText(server: McpServer): void {
  server.registerTool(
    'read_text',
    {
      title: 'Read PDF Text',
      description: `Extract text content from a PDF document with Y-coordinate-based reading order preservation.

Text is extracted page by page, sorted by vertical position (top to bottom) then horizontal position (left to right), providing natural reading order.

Args:
  - file_path (string): Absolute path to a local PDF file
  - pages (string, optional): Page range to extract. Format: "1-5", "3", or "1,3,5-7". Omit for all pages.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Extracted text organized by page number.

Examples:
  - Extract all text: { file_path: "/path/to/doc.pdf" }
  - Extract pages 1-3: { file_path: "/path/to/doc.pdf", pages: "1-3" }
  - Extract specific pages: { file_path: "/path/to/doc.pdf", pages: "1,5,10" }`,
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
        const pages = await extractText(params.file_path, params.pages);

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
        return {
          content: [{ type: 'text' as const, text: handleError(error) }],
        };
      }
    },
  );
}
