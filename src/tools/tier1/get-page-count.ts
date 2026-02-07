/**
 * get_page_count - Lightweight page count retrieval.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type GetPageCountInput, GetPageCountSchema } from '../../schemas/tier1.js';
import { loadDocument } from '../../services/pdfjs-service.js';
import { handleError } from '../../utils/error-handler.js';

export function registerGetPageCount(server: McpServer): void {
  server.registerTool(
    'get_page_count',
    {
      title: 'Get PDF Page Count',
      description: `Get the total number of pages in a PDF document.

This is a lightweight operation that only reads the PDF header, not the full content.

Args:
  - file_path (string): Absolute path to a local PDF file

Returns:
  Page count as a number.

Examples:
  - Quick check before deciding which pages to extract
  - Validate a PDF file is readable`,
      inputSchema: GetPageCountSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: GetPageCountInput) => {
      try {
        const doc = await loadDocument(params.file_path);
        try {
          const count = doc.numPages;
          return {
            content: [{ type: 'text' as const, text: String(count) }],
          };
        } finally {
          await doc.destroy();
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: handleError(error) }],
        };
      }
    },
  );
}
