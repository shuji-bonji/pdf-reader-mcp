/**
 * inspect_signatures - PDF digital signature analysis.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type InspectSignaturesInput, InspectSignaturesSchema } from '../../schemas/tier2.js';
import { analyzeSignatures } from '../../services/pdflib-service.js';
import { handleError } from '../../utils/error-handler.js';
import { formatSignaturesMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerInspectSignatures(server: McpServer): void {
  server.registerTool(
    'inspect_signatures',
    {
      title: 'Inspect PDF Digital Signatures',
      description: `Examine digital signature fields in a PDF document.

Args:
  - file_path (string): Absolute path to a local PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Total signature field count, signed/unsigned breakdown, and details for each field (signer name, reason, location, signing time, filter/subFilter).

Note: This tool inspects signature field structure only. Cryptographic signature verification is not performed.

Examples:
  - Check if a PDF has been digitally signed
  - Inspect signer information and signing dates
  - Verify signature field structure`,
      inputSchema: InspectSignaturesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: InspectSignaturesInput) => {
      try {
        const analysis = await analyzeSignatures(params.file_path);

        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(analysis, null, 2)
            : formatSignaturesMarkdown(analysis);

        const { text } = truncateIfNeeded(raw);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleError(error) }] };
      }
    },
  );
}
