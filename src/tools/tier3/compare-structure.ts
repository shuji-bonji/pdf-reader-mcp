/**
 * compare_structure - Compare structures of two PDF documents.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type CompareStructureInput, CompareStructureSchema } from '../../schemas/tier3.js';
import { compareStructure } from '../../services/validation-service.js';
import { handleError } from '../../utils/error-handler.js';
import { formatCompareStructureMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerCompareStructure(server: McpServer): void {
  server.registerTool(
    'compare_structure',
    {
      title: 'Compare PDF Structures',
      description: `Compare the internal structures of two PDF documents and identify differences.

Args:
  - file_path_1 (string): Absolute path to the first PDF file
  - file_path_2 (string): Absolute path to the second PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Structural comparison including: property-by-property diff (page count, PDF version, encryption, tagged status, object counts, page dimensions, file size, catalog entries, signatures), font comparison (fonts unique to each file and shared fonts), and a summary.

Examples:
  - Compare two versions of the same document
  - Verify structural consistency across PDF exports
  - Identify differences in PDF generation pipelines`,
      inputSchema: CompareStructureSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: CompareStructureInput) => {
      try {
        const result = await compareStructure(params.file_path_1, params.file_path_2);

        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(result, null, 2)
            : formatCompareStructureMarkdown(result);

        const { text } = truncateIfNeeded(raw);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleError(error) }] };
      }
    },
  );
}
