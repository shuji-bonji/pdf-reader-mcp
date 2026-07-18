/**
 * validate_tagged - PDF/UA tagged structure validation.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type ValidateTaggedInput, ValidateTaggedSchema } from '../../schemas/tier3.js';
import { validateTagged } from '../../services/validation-service.js';
import { handleStructuredError } from '../../utils/error-handler.js';
import { formatTaggedValidationMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerValidateTagged(server: McpServer): void {
  server.registerTool(
    'validate_tagged',
    {
      title: 'Validate Tagged PDF (deprecated)',
      description: `[DEPRECATED — will be removed in the next major version]

Prefer pdf-verify-mcp's \`validate_conformance\` with \`flavour: "pdfua-1"\` (or \`"pdfua-2"\`).
It supersedes this tool rather than merely replacing it: it verifies the actual \`/Alt\` and
\`/ActualText\` values of Figure tags (this tool only counts Figures), checks Link \`/Contents\`,
inspects StructTreeRoot from the catalog directly (this tool synthesises it per page), cites
ISO 14289 clauses, and delegates to veraPDF when available.

Reason: the family boundary is "pass/fail against an ISO standard belongs to pdf-verify-mcp;
reporting observations belongs to pdf-reader-mcp". This tool predates pdf-verify-mcp and was
the exception. Use \`inspect_tags\` here for structure-tree facts — that tool is NOT deprecated.

This tool remains a quick preflight and still works. Only the checks below are performed;
a pass here does not imply PDF/UA conformance.

Validate PDF/UA tagged structure requirements.

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
        const err = handleStructuredError(error);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(err, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
