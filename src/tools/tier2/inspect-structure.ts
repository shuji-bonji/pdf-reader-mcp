/**
 * inspect_structure - PDF internal structure analysis.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { ResponseFormat } from '../../constants.js';
import { type InspectStructureInput, InspectStructureSchema } from '../../schemas/tier2.js';
import { analyzeStructure } from '../../services/structure-service.js';
import { handleStructuredError } from '../../utils/error-handler.js';
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
  Catalog entries (keys and COS types), page tree info (page count, MediaBox samples), object statistics, and encryption status.

Object statistics report three separate counts:
  - byType: the COS type of each indirect object (ISO 32000-2 §7.3) — one of
    dict, stream, array, name, string, integer, real, boolean, null, ref
  - byDocType: the /Type of each dictionary (Catalog, Pages, Page, Font, ObjStm, XRef, ...)
  - unreadable: objects the cross-reference table names but that could not be read.
    This is counted apart from totalObjects: 0 means "every object was read", not "nothing was checked".

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
        const err = handleStructuredError(error);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(err, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
