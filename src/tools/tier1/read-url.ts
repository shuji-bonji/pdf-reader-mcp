/**
 * read_url - Fetch and extract text from a remote PDF.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type ReadUrlInput, ReadUrlSchema } from '../../schemas/tier1.js';
import { extractTextFromDoc, loadDocumentFromData } from '../../services/pdfjs-service.js';
import {
  byPage,
  observeExtractabilityFromData,
  summarizeExtractability,
} from '../../services/text-extractability-service.js';
import { fetchPdfFromUrl } from '../../services/url-fetcher.js';
import { handleStructuredError } from '../../utils/error-handler.js';
import { formatPageTextsMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerReadUrl(server: McpServer): void {
  server.registerTool(
    'read_url',
    {
      title: 'Read PDF from URL',
      description: `Fetch a PDF from a URL and extract its text content. Text is ALL this tool returns — see the scope note below.

Downloads the PDF from the specified URL, then extracts text with Y-coordinate-based reading order. Supports HTTP and HTTPS. Maximum file size: 50MB. Timeout: 30 seconds.

**Scope (#25):** the fetched bytes are discarded after extraction; this tool deliberately does not save them. Every other tool of this server takes a \`file_path\`, so to use search_text, inspect_structure, extract_tables, render_page or anything else on a URL's PDF, download the file to local disk FIRST (with whatever fetch capability the calling environment has) and pass its path. This keeps every tool of this server read-only with respect to the file system — writing files is not a reader's job. read_url exists for the one-shot case: "what does the document at this URL say?"

Like \`read_text\`, accepts \`split_columns: 2 | 3\` for **untagged** multi-column PDFs and \`compact_whitespace: true\` to collapse U+3000 / ASCII whitespace runs. Tagged PDFs should use \`extract_tables\` instead.

Args:
  - url (string): URL pointing to a PDF file (HTTP or HTTPS)
  - pages (string, optional): Page range to extract. Format: "1-5", "3", or "1,3,5-7". Omit for all pages.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')
  - split_columns (1 | 2 | 3, optional): Column-aware reordering. Default 1 = existing Y-sort.
  - compact_whitespace (boolean, optional): Collapse whitespace runs (incl. U+3000) to one ASCII space. Default false.

Returns:
  Extracted text organized by page number, same format as read_text.

Examples:
  - Read remote PDF: { url: "https://example.com/document.pdf" }
  - Untagged 2-column PDF: { url: "https://...", split_columns: 2 }
  - Japanese form: { url: "https://...", compact_whitespace: true }`,
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
          const [extracted, observations] = await Promise.all([
            extractTextFromDoc(doc, params.pages, {
              splitColumns: params.split_columns,
              compactWhitespace: params.compact_whitespace,
            }),
            // #21: the same three-state answer as read_text — the fetched bytes
            // are already here, so there is no reason for this path to be the
            // one that still returns a bare empty string.
            observeExtractabilityFromData(data, params.pages),
          ]);

          const observed = byPage(observations);
          const results = extracted.map((page) => ({
            ...page,
            ...(observed.has(page.page) ? { extractability: observed.get(page.page) } : {}),
          }));

          let text: string;
          if (params.response_format === ResponseFormat.JSON) {
            text = JSON.stringify(results, null, 2);
          } else {
            text = [
              ...summarizeExtractability(observations),
              '',
              formatPageTextsMarkdown(results),
            ].join('\n');
          }

          const { text: finalText } = truncateIfNeeded(text);
          return {
            content: [{ type: 'text' as const, text: finalText }],
          };
        } finally {
          await doc.destroy();
        }
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
