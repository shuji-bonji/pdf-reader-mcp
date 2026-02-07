/**
 * validate_metadata - PDF metadata conformance validation.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type ValidateMetadataInput, ValidateMetadataSchema } from '../../schemas/tier3.js';
import { validateMetadata } from '../../services/validation-service.js';
import { handleError } from '../../utils/error-handler.js';
import { formatMetadataValidationMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerValidateMetadata(server: McpServer): void {
  server.registerTool(
    'validate_metadata',
    {
      title: 'Validate PDF Metadata',
      description: `Validate PDF metadata conformance against best practices and specification requirements.

Args:
  - file_path (string): Absolute path to a local PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Validation results including: total checks, pass/fail counts, detailed issues with severity, metadata field presence summary, and an overall summary.

Checks performed:
  - Title presence (required for PDF/UA, PDF/A)
  - Author presence
  - Creation date format validation
  - Modification date presence
  - Producer identification
  - PDF version detection
  - Tagged flag status
  - Subject and Keywords presence
  - Encryption and accessibility impact

Examples:
  - Verify PDF metadata completeness for PDF/A archival
  - Check metadata requirements for PDF/UA compliance
  - Audit document metadata for publishing standards`,
      inputSchema: ValidateMetadataSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ValidateMetadataInput) => {
      try {
        const result = await validateMetadata(params.file_path);

        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(result, null, 2)
            : formatMetadataValidationMarkdown(result);

        const { text } = truncateIfNeeded(raw);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleError(error) }] };
      }
    },
  );
}
