/**
 * read_url - Fetch and extract text from a remote PDF.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type ReadUrlInput, ReadUrlSchema } from '../../schemas/tier1.js';
import { extractTextFromDoc, loadDocumentFromData } from '../../services/pdfjs-service.js';
import { fetchPdfFromUrl } from '../../services/url-fetcher.js';
import { handleError } from '../../utils/error-handler.js';
import { formatPageTextsMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerReadUrl(server: McpServer): void {
  server.registerTool(
    'read_url',
    {
      title: 'Read PDF from URL',
      description: `Fetch a PDF from a URL and extract its text content.

Downloads the PDF from the specified URL, then extracts text with Y-coordinate-based reading order. Supports HTTP and HTTPS. Maximum file size: 50MB. Timeout: 30 seconds.

Args:
  - url (string): URL pointing to a PDF file (HTTP or HTTPS)
  - pages (string, optional): Page range to extract. Format: "1-5", "3", or "1,3,5-7". Omit for all pages.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Extracted text organized by page number, same format as read_text.

Examples:
  - Read remote PDF: { url: "https://example.com/document.pdf" }
  - Read specific pages: { url: "https://example.com/doc.pdf", pages: "1-3" }`,
      inputSchema: ReadUrlSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: ReadUrlInput) => {
      try {
        const data = await fetchPdfFromUrl(params.url);
        const doc = await loadDocumentFromData(data);

        try {
          const results = await extractTextFromDoc(doc, params.pages);

          let text: string;
          if (params.response_format === ResponseFormat.JSON) {
            text = JSON.stringify(results, null, 2);
          } else {
            text = formatPageTextsMarkdown(results);
          }

          const { text: finalText } = truncateIfNeeded(text);
          return {
            content: [{ type: 'text' as const, text: finalText }],
          };
        } finally {
          await doc.destroy();
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: handleError(error) }],
        };
      }
    },
  );
}
