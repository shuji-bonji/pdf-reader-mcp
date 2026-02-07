/**
 * get_metadata - PDF metadata extraction.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type GetMetadataInput, GetMetadataSchema } from '../../schemas/tier1.js';
import { getMetadata } from '../../services/pdfjs-service.js';
import { handleError } from '../../utils/error-handler.js';
import { formatMetadataMarkdown } from '../../utils/formatter.js';

export function registerGetMetadata(server: McpServer): void {
  server.registerTool(
    'get_metadata',
    {
      title: 'Get PDF Metadata',
      description: `Extract metadata from a PDF document including title, author, creation date, page count, PDF version, and structural information.

Args:
  - file_path (string): Absolute path to a local PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Metadata including: title, author, subject, keywords, creator, producer, creation/modification dates, page count, PDF version, linearized/encrypted/tagged/signature flags, file size.

Examples:
  - Get document properties for cataloging
  - Check if a PDF is tagged (accessibility)
  - Verify PDF version compatibility`,
      inputSchema: GetMetadataSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: GetMetadataInput) => {
      try {
        const metadata = await getMetadata(params.file_path);

        const text =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(metadata, null, 2)
            : formatMetadataMarkdown(metadata);

        return {
          content: [{ type: 'text' as const, text }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: handleError(error) }],
        };
      }
    },
  );
}
