/**
 * read_url - Fetch and extract text from a remote PDF.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';
import { ResponseFormat } from '../../constants.js';
import { type ReadUrlInput, ReadUrlSchema } from '../../schemas/tier1.js';
import { loadDocumentFromData } from '../../services/pdfjs-service.js';
import { fetchPdfFromUrl } from '../../services/url-fetcher.js';
import type { PageText } from '../../types.js';
import { handleError } from '../../utils/error-handler.js';
import { formatPageTextsMarkdown, truncateIfNeeded } from '../../utils/formatter.js';
import { parsePageRange } from '../../utils/pdf-helpers.js';

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
          const pageNumbers =
            parsePageRange(params.pages, doc.numPages) ??
            Array.from({ length: doc.numPages }, (_, i) => i + 1);

          const results: PageText[] = [];
          for (const pageNum of pageNumbers) {
            const page = await doc.getPage(pageNum);
            const content = await page.getTextContent();
            const items = content.items.filter((item): item is TextItem => 'str' in item);

            // Y-coordinate-based sorting
            items.sort((a, b) => {
              const yDiff = (b.transform[5] ?? 0) - (a.transform[5] ?? 0);
              if (Math.abs(yDiff) > 2) return yDiff;
              return (a.transform[4] ?? 0) - (b.transform[4] ?? 0);
            });

            const lines: string[] = [];
            let currentLine: string[] = [];
            let lastY = items[0]?.transform[5] ?? 0;

            for (const item of items) {
              const y = item.transform[5] ?? 0;
              if (Math.abs(y - lastY) > 2) {
                if (currentLine.length > 0) {
                  lines.push(currentLine.join(' '));
                  currentLine = [];
                }
              }
              currentLine.push(item.str);
              lastY = y;
            }
            if (currentLine.length > 0) {
              lines.push(currentLine.join(' '));
            }

            results.push({ page: pageNum, text: lines.join('\n') });
          }

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
