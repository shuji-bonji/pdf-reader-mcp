/**
 * inspect_structure - PDF internal structure analysis.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type InspectStructureInput, InspectStructureSchema } from '../../schemas/tier2.js';
import { analyzeStructure } from '../../services/pdflib-service.js';
import { handleError } from '../../utils/error-handler.js';
import { formatStructureMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerInspectStructure(server: McpServer): void {
  server.registerTool(
    'inspect_structure',
    {
      title: 'Inspect PDF Structure',
      description: `Examine PDF internal object structure including catalog entries, page tree, and object statistics.

Args:
  - file_path (string): Absolute path to a local PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Catalog entries (keys and types), page tree info (page count, MediaBox samples), object statistics (total count, stream count, type distribution), and encryption status.

Examples:
  - Examine document catalog for structural features
  - Count PDF objects and streams
  - Check page dimensions across the document`,
      inputSchema: InspectStructureSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: InspectStructureInput) => {
      try {
        const analysis = await analyzeStructure(params.file_path);

        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(analysis, null, 2)
            : formatStructureMarkdown(analysis);

        const { text } = truncateIfNeeded(raw);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleError(error) }] };
      }
    },
  );
}
