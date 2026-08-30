/**
 * read_url - Fetch and extract text from a remote PDF.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { ResponseFormat } from '../../constants.js';
import { type ReadUrlInput, ReadUrlSchema } from '../../schemas/tier1.js';
import { extractTextFromDoc, loadDocumentFromData } from '../../services/pdfjs-service.js';
import { bothFailedError, bothHalves, formatReadingScope } from '../../services/reading-scope.js';
import {
  byPage,
  observeExtractabilityFromData,
  summarizeExtractability,
} from '../../services/text-extractability-service.js';
import { fetchPdfFromUrl } from '../../services/url-fetcher.js';
import type { PageText } from '../../types.js';
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
  \`{ scope, pages }\`, the same shape as read_text: \`pages\` is the extracted text by page number, and \`scope\` says which of the two readings behind it were done — taking the characters off the page, and observing whether those characters have a route to Unicode (ISO 32000-2 §9.10.1). Either can fail on its own; only when neither could be done is this an error, and it then names both reasons.

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
      let data: Uint8Array;
      try {
        data = await fetchPdfFromUrl(params.url);
      } catch (error) {
        // 取ってこられなければ、どちらの読み方も始まらない。ここだけは 1 つの理由。
        const err = handleStructuredError(error);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(err, null, 2) }],
          isError: true,
        };
      }

      // 🔴 pdfjs は渡された配列の中身を worker へ移す。移したあと元の配列は空になり、
      // 同じ配列を読む 2 人目には 0 バイトに見える（実測: loadDocumentFromData の
      // あと data.buffer.byteLength === 0、data.slice が detached ArrayBuffer で落ちる）。
      // 0.13.0 ではそれが原因で read_url が全検体で「No PDF header found」を返していた。
      // 読み手が 2 人いるので、それぞれに自分の分を渡す。
      const forObservation = new Uint8Array(data);

      let doc: Awaited<ReturnType<typeof loadDocumentFromData>> | undefined;
      const {
        text: extraction,
        observation,
        scope,
      } = await bothHalves(
        async () => {
          doc = await loadDocumentFromData(data);
          return extractTextFromDoc(doc, params.pages, {
            splitColumns: params.split_columns,
            compactWhitespace: params.compact_whitespace,
          });
        },
        // #21: the same four-state answer as read_text — the fetched bytes are
        // already here, so there is no reason for this path to be the one that
        // still returns a bare empty string.
        () => observeExtractabilityFromData(forObservation, params.pages),
      );
      if (doc) await doc.destroy();

      if (!extraction.ok && !observation.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(bothFailedError(extraction.error, observation.error), null, 2),
            },
          ],
          isError: true,
        };
      }

      const observations = observation.ok ? observation.value : [];
      const observed = byPage(observations);
      const results: PageText[] = extraction.ok
        ? extraction.value.map((page) => ({
            ...page,
            ...(observed.has(page.page) ? { extractability: observed.get(page.page) } : {}),
          }))
        : observations.map((o) => ({ page: o.page, text: null, extractability: o }));

      let text: string;
      if (params.response_format === ResponseFormat.JSON) {
        text = JSON.stringify({ scope, pages: results }, null, 2);
      } else {
        const banner = observation.ok ? summarizeExtractability(observations) : [];
        text = [
          ...formatReadingScope(scope),
          '',
          ...banner,
          '',
          formatPageTextsMarkdown(results),
        ].join('\n');
      }

      const { text: finalText } = truncateIfNeeded(text);
      return {
        content: [{ type: 'text' as const, text: finalText }],
      };
    },
  );
}
