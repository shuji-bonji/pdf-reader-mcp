/**
 * summarize - Quick overview report of a PDF document.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type SummarizeInput, SummarizeSchema } from '../../schemas/tier1.js';
import {
  countImagesFromDoc,
  extractTextFromDoc,
  getMetadataFromDoc,
  loadDocument,
} from '../../services/pdfjs-service.js';
import {
  foldExtractability,
  observeExtractability,
} from '../../services/text-extractability-service.js';
import type { PdfSummary } from '../../types.js';
import { handleStructuredError } from '../../utils/error-handler.js';
import { formatSummaryMarkdown } from '../../utils/formatter.js';

export function registerSummarize(server: McpServer): void {
  server.registerTool(
    'summarize',
    {
      title: 'Summarize PDF',
      description: `Generate a quick overview report of a PDF document.

Combines metadata, text presence check, image count, and a text preview from the first page into a single summary. Useful as a first step before deciding which detailed tools to use.

Args:
  - file_path (string): Absolute path to a local PDF file
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

\`hasText\` is decided from page 1's preview and cannot say *why* text is absent. \`textExtractability\` answers that over every page (ISO 32000-2 §9.10.1): \`extracted\`, \`no_text_layer\` (image content, no text-showing operator — the page needs OCR or a rendered image), \`not_extractable\` (a font used offers no route to Unicode), or \`not_observed\` (encrypted or unreadable content stream). \`unreadablePages\` lists the pages that are not \`extracted\`, with the reason.

Returns:
  Summary including: page count, PDF version, file size, tagged/encrypted/signature flags, text presence, per-document text extractability, the pages that are not fully extractable, image count, and a text preview from page 1.

Examples:
  - Quick overview: { file_path: "/path/to/doc.pdf" }
  - Machine-readable: { file_path: "/path/to/doc.pdf", response_format: "json" }`,
      inputSchema: SummarizeSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: SummarizeInput) => {
      try {
        // Load the PDF document once and reuse for all operations
        const doc = await loadDocument(params.file_path);

        try {
          const [metadata, firstPageTexts, imageCount, observations] = await Promise.all([
            getMetadataFromDoc(doc, params.file_path),
            extractTextFromDoc(doc, '1'),
            countImagesFromDoc(doc),
            // #21: over ALL pages, not just page 1. `hasText` is decided from
            // the first page's preview, so a document whose page 1 happens to
            // carry a title would otherwise report "has text" for 400 scanned
            // pages behind it.
            observeExtractability(params.file_path),
          ]);

          const textPreview = firstPageTexts[0]?.text?.slice(0, 500) ?? '';
          const hasText = textPreview.trim().length > 0;

          const summary: PdfSummary = {
            filePath: params.file_path,
            metadata,
            textPreview,
            imageCount,
            hasText,
            textExtractability: foldExtractability(observations),
            unreadablePages: observations.filter((page) => page.state !== 'extracted'),
          };

          const text =
            params.response_format === ResponseFormat.JSON
              ? JSON.stringify(summary, null, 2)
              : formatSummaryMarkdown(summary);

          return {
            content: [{ type: 'text' as const, text }],
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
