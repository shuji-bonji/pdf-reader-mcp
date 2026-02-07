/**
 * summarize - Quick overview report of a PDF document.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type SummarizeInput, SummarizeSchema } from '../../schemas/tier1.js';
import { countImages, extractText, getMetadata } from '../../services/pdfjs-service.js';
import type { PdfSummary } from '../../types.js';
import { handleError } from '../../utils/error-handler.js';
import { formatSummaryMarkdown } from '../../utils/formatter.js';

export function registerSummarize(server: McpServer): void {
  server.registerTool(
    'summarize',
    {
      title: 'Summarize PDF',
      description: `Generate a quick overview report of a PDF document.

Combines metadata, text presence check, image count, and a text preview from the first page into a single summary. Useful as a first step before deciding which detailed tools to use.

Args:
  - file_path (string): Absolute path to a local PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Summary including: page count, PDF version, file size, tagged/encrypted/signature flags, text presence, image count, and a text preview from page 1.

Examples:
  - Quick overview: { file_path: "/path/to/doc.pdf" }
  - Machine-readable: { file_path: "/path/to/doc.pdf", response_format: "json" }`,
      inputSchema: SummarizeSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: SummarizeInput) => {
      try {
        // Run metadata, text preview, and image count in parallel
        const [metadata, firstPageTexts, imageCount] = await Promise.all([
          getMetadata(params.file_path),
          extractText(params.file_path, '1'),
          countImages(params.file_path),
        ]);

        const textPreview = firstPageTexts[0]?.text?.slice(0, 500) ?? '';
        const hasText = textPreview.trim().length > 0;

        const summary: PdfSummary = {
          filePath: params.file_path,
          metadata,
          textPreview,
          imageCount,
          hasText,
        };

        const text =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(summary, null, 2)
            : formatSummaryMarkdown(summary);

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
