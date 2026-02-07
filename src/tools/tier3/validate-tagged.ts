/**
 * validate_tagged - PDF/UA tagged structure validation.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type ValidateTaggedInput, ValidateTaggedSchema } from '../../schemas/tier3.js';
import { validateTagged } from '../../services/validation-service.js';
import { handleError } from '../../utils/error-handler.js';
import { formatTaggedValidationMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerValidateTagged(server: McpServer): void {
  server.registerTool(
    'validate_tagged',
    {
      title: 'Validate Tagged PDF',
      description: `Validate PDF/UA tagged structure requirements.

Args:
  - file_path (string): Absolute path to a local PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Validation results including: whether the PDF is tagged, total checks performed, pass/fail counts, detailed issues with severity levels (error/warning/info), and a summary.

Checks performed:
  - Document marked as tagged
  - Structure tree root existence
  - Document root tag presence
  - Heading hierarchy (H1-H6) sequential order
  - Figure tags for images
  - Paragraph tag presence
  - Structure element count
  - Table tag structure (TR/TH/TD)

Examples:
  - Check if a PDF meets PDF/UA accessibility requirements
  - Identify missing or incorrect tag structure
  - Assess document accessibility quality`,
      inputSchema: ValidateTaggedSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ValidateTaggedInput) => {
      try {
        const result = await validateTagged(params.file_path);

        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(result, null, 2)
            : formatTaggedValidationMarkdown(result);

        const { text } = truncateIfNeeded(raw);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleError(error) }] };
      }
    },
  );
}
