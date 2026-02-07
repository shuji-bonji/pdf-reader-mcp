/**
 * inspect_annotations - PDF annotation analysis.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type InspectAnnotationsInput, InspectAnnotationsSchema } from '../../schemas/tier2.js';
import { analyzeAnnotations } from '../../services/pdfjs-service.js';
import { handleError } from '../../utils/error-handler.js';
import { formatAnnotationsMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerInspectAnnotations(server: McpServer): void {
  server.registerTool(
    'inspect_annotations',
    {
      title: 'Inspect PDF Annotations',
      description: `Extract and categorize all annotations in a PDF document.

Args:
  - file_path (string): Absolute path to a local PDF file
  - pages (string, optional): Page range. Format: "1-5", "3", or "1,3,5-7". Omit for all pages.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Total annotation count, breakdown by subtype (Link, Widget, Highlight, Text, etc.) and by page, flags for links/forms/markup presence, and individual annotation details.

Examples:
  - Check for form fields (Widget annotations)
  - Find all links in a document
  - Inventory markup annotations (highlights, comments)`,
      inputSchema: InspectAnnotationsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: InspectAnnotationsInput) => {
      try {
        const analysis = await analyzeAnnotations(params.file_path, params.pages);

        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(analysis, null, 2)
            : formatAnnotationsMarkdown(analysis);

        const { text } = truncateIfNeeded(raw);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleError(error) }] };
      }
    },
  );
}
