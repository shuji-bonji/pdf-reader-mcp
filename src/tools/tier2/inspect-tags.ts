/**
 * inspect_tags - Tagged PDF structure tree analysis.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type InspectTagsInput, InspectTagsSchema } from '../../schemas/tier2.js';
import { analyzeTags } from '../../services/pdfjs-service.js';
import { handleError } from '../../utils/error-handler.js';
import { formatTagsMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerInspectTags(server: McpServer): void {
  server.registerTool(
    'inspect_tags',
    {
      title: 'Inspect Tagged PDF Structure',
      description: `Analyze the Tagged PDF structure tree for accessibility assessment.

Args:
  - file_path (string): Absolute path to a local PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Whether the PDF is tagged, the structure tree hierarchy with roles, max nesting depth, total element count, and role distribution (e.g., Document, P, H1, Table, Figure).

Examples:
  - Check if a PDF is tagged for accessibility (PDF/UA)
  - Inspect the tag hierarchy and role distribution
  - Assess document structure quality`,
      inputSchema: InspectTagsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: InspectTagsInput) => {
      try {
        const analysis = await analyzeTags(params.file_path);

        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(analysis, null, 2)
            : formatTagsMarkdown(analysis);

        const { text } = truncateIfNeeded(raw);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleError(error) }] };
      }
    },
  );
}
