/**
 * inspect_fonts - PDF font analysis.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type InspectFontsInput, InspectFontsSchema } from '../../schemas/tier2.js';
import { analyzeFontsWithPdfLib } from '../../services/pdflib-service.js';
import type { FontsAnalysis } from '../../types.js';
import { handleError } from '../../utils/error-handler.js';
import { formatFontsMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerInspectFonts(server: McpServer): void {
  server.registerTool(
    'inspect_fonts',
    {
      title: 'Inspect PDF Fonts',
      description: `List all fonts used in a PDF document with their properties.

Args:
  - file_path (string): Absolute path to a local PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Font name, type (TrueType, Type1, CIDFont, etc.), encoding, embedded/subset status, and pages where each font is used.

Examples:
  - Check if all fonts are embedded (required for PDF/A, PDF/X)
  - Identify font types and encodings
  - Find which pages use specific fonts`,
      inputSchema: InspectFontsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: InspectFontsInput) => {
      try {
        const result = await analyzeFontsWithPdfLib(params.file_path);
        const fonts = Array.from(result.fontMap.values());

        const analysis: FontsAnalysis = {
          fonts,
          totalFontCount: fonts.length,
          embeddedCount: fonts.filter((f) => f.isEmbedded).length,
          subsetCount: fonts.filter((f) => f.isSubset).length,
          pagesScanned: result.pagesScanned,
        };

        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(analysis, null, 2)
            : formatFontsMarkdown(analysis);

        const { text } = truncateIfNeeded(raw);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleError(error) }] };
      }
    },
  );
}
