/**
 * get_metadata - PDF metadata extraction.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { ResponseFormat } from '../../constants.js';
import { type GetMetadataInput, GetMetadataSchema } from '../../schemas/tier1.js';
import { getMetadata } from '../../services/pdfjs-service.js';
import { handleStructuredError } from '../../utils/error-handler.js';
import { formatMetadataMarkdown } from '../../utils/formatter.js';

export function registerGetMetadata(server: McpServer): void {
  server.registerTool(
    'get_metadata',
    {
      title: 'Get PDF Metadata',
      description: `Extract metadata from a PDF document including title, author, creation date, page count, PDF version, and structural information.

Args:
  - file_path (string): Absolute path to a local PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Metadata including: title, author, subject, keywords, creator, producer, creation/modification dates, page count, PDF version, linearized/encrypted/tagged/signature flags, file size.

  The eight document-level fields are read from both the document information dictionary (ISO 32000-2 §14.3.3) and the XMP metadata stream (§14.3.2: dc:title, dc:creator, dc:description, pdf:Keywords, xmp:CreatorTool, pdf:Producer, xmp:CreateDate, xmp:ModifyDate). When both hold a value, PDF 2.0 and later use the XMP value (§14.3.3 deprecates the dictionary for this in PDF 2.0) and earlier versions use the dictionary — except the two dates, which use the dictionary in every version: §14.3.3 does not deprecate CreationDate and ModDate, and §14.5 compares PieceInfo's LastModified with the dictionary's ModDate. Values are returned as written: dictionary dates look like "D:20260915100000+09'00'", XMP dates like "2026-09-15T10:00:00+09:00".
  metadataSources names the source of each field ("info", "xmp" or null). metadataConflicts lists fields where the two sources differ (dates compared as instants) — this server does not say which one is right. xmpMetadata says whether the stream was read, is absent, or is present but could not be read; "could not be read" is not "absent".

Examples:
  - Get document properties for cataloging
  - Check if a PDF is tagged (accessibility)
  - Verify PDF version compatibility`,
      inputSchema: GetMetadataSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: GetMetadataInput) => {
      try {
        const metadata = await getMetadata(params.file_path);

        const text =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(metadata, null, 2)
            : formatMetadataMarkdown(metadata);

        return {
          content: [{ type: 'text' as const, text }],
        };
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
