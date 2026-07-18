/**
 * validate_metadata - PDF metadata conformance validation.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type ValidateMetadataInput, ValidateMetadataSchema } from '../../schemas/tier3.js';
import { validateMetadata } from '../../services/validation-service.js';
import { handleStructuredError } from '../../utils/error-handler.js';
import { formatMetadataValidationMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerValidateMetadata(server: McpServer): void {
  server.registerTool(
    'validate_metadata',
    {
      title: 'Validate PDF Metadata (deprecated)',
      description: `[DEPRECATED — will be removed in the next major version]

For standards conformance, prefer pdf-verify-mcp's \`validate_conformance\`
(\`flavour: "pdfua-1"\` / \`"pdfa-*"\`), which judges against the ISO text and delegates to
veraPDF when available. Use \`get_metadata\` here if you just want to read metadata fields.

Reason: the family boundary is "pass/fail against an ISO standard belongs to pdf-verify-mcp;
reporting observations belongs to pdf-reader-mcp". This tool predates pdf-verify-mcp.

Known limitation (not being fixed — superseded): the checks read the document information
dictionary only. PDF/UA-1 §7.1 requires \`dc:title\` in the XMP metadata stream and states a
conforming reader "shall ignore" the Info dictionary; it also requires
\`ViewerPreferences/DisplayDocTitle = true\` and \`Suspects = false\`, none of which are checked
here. ISO 32000-2 §14.3.3 deprecates the Info dictionary except CreationDate/ModDate.
Treat the results below as general best-practice hints, not PDF/UA or PDF/A grounds.

Validate PDF metadata conformance against best practices and specification requirements.

Args:
  - file_path (string): Absolute path to a local PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Validation results including: total checks, pass/fail counts, detailed issues with severity, metadata field presence summary, and an overall summary.

Checks performed (all against the Info dictionary — see the limitation above):
  - Title presence (best practice; NOT the PDF/UA basis, which is XMP dc:title)
  - Author presence
  - Creation date format validation
  - Modification date presence
  - Producer identification
  - PDF version detection
  - Tagged flag status
  - Subject and Keywords presence
  - Encryption and accessibility impact

Examples:
  - Quick check of document metadata completeness for publishing standards
  - (For PDF/A archival or PDF/UA compliance, use pdf-verify-mcp validate_conformance instead)`,
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
        const err = handleStructuredError(error);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(err, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
