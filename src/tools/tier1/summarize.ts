/**
 * summarize - Quick overview report of a PDF document.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { ResponseFormat } from '../../constants.js';
import { type SummarizeInput, SummarizeSchema } from '../../schemas/tier1.js';
import {
  countImagesFromDoc,
  extractTextFromDoc,
  getMetadataFromDoc,
  loadDocument,
} from '../../services/pdfjs-service.js';
import {
  bothFailedError,
  formatSummaryScope,
  half,
  type PartOutcome,
  type SummaryScope,
} from '../../services/reading-scope.js';
import {
  foldExtractability,
  observeExtractability,
} from '../../services/text-extractability-service.js';
import type {
  PageExtractability,
  PdfMetadata,
  PdfSummary,
  TextExtractabilityState,
} from '../../types.js';
import { formatSummaryMarkdown } from '../../utils/formatter.js';

/**
 * Derive "what to call next" from the summary's own observations (#24).
 *
 * Rules, not inference: each suggestion names the observation it follows from,
 * so the caller can check the premise instead of trusting the advice. Ordering
 * between suggestions is not implied, and nothing here is enforced — the MCP
 * layer observes; orchestration belongs to the Skill above it.
 */
function suggestNext(
  metadata: PdfMetadata | null,
  textExtractability: TextExtractabilityState | null,
  unreadablePages: PageExtractability[] | null,
): string[] {
  const next: string[] = [];

  // 🔴 観測できなかった前提からは何も勧めない。読まなかったことを
  // 「そうではなかった」として扱うと、助言が観測の顔をする。
  if (!metadata) return next;

  if (metadata.isEncrypted) {
    next.push(
      'isEncrypted is true: content streams and strings are ciphertext to this server ' +
        '(ISO 32000-2 §7.6.2), so text and structure tools will under-report. Decrypt the ' +
        'file first if its content is needed.',
    );
    return next;
  }

  const unreadable = (unreadablePages ?? []).filter(
    (page) => page.state === 'no_text_layer' || page.state === 'not_extractable',
  );
  if (textExtractability === 'no_text_layer' || textExtractability === 'not_extractable') {
    const pageList = formatPageList(unreadable.map((page) => page.page));
    next.push(
      `textExtractability is ${textExtractability} (page ${pageList}): read those pages as ` +
        'images with render_page — read_text cannot represent them.',
    );
  }

  if (metadata.isTagged) {
    next.push(
      'isTagged is true: extract_structured_text returns the body in logical content order ' +
        '(ISO 32000-2 §14.8.2.5) with real heading levels, and extract_tables returns ' +
        '<Table> elements with columns intact. Both beat coordinate-sorted read_text here.',
    );
  }

  if (metadata.pageCount > LARGE_DOCUMENT_PAGES) {
    next.push(
      `pageCount is ${metadata.pageCount}: read_text with pages omitted returns every page ` +
        'and will be truncated. search_text first, then read_text with an explicit pages ' +
        'range, keeps the response inside its limits.',
    );
  }

  return next;
}

/** Pages 50 and under fit a single read_text response comfortably. */
const LARGE_DOCUMENT_PAGES = 50;

/** "3", "3, 5", or "1-2, 7" — compact, and in page order. */
function formatPageList(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = -1;
  let previous = -2;
  for (const page of sorted) {
    if (page === previous + 1) {
      previous = page;
      continue;
    }
    if (start >= 0) parts.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = page;
    previous = page;
  }
  if (start >= 0) parts.push(start === previous ? `${start}` : `${start}-${previous}`);
  return parts.join(', ');
}

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

The summary ends with a \`next\` list: tool suggestions derived from the observations themselves (hasText false → render_page; tagged → extract_structured_text / extract_tables; large page count → search_text before read_text). Each line names the observation it follows from; nothing is enforced and no ordering is implied.

Returns:
  Summary including: page count, PDF version, file size, tagged/encrypted/signature flags, text presence, per-document text extractability, the pages that are not fully extractable, image count, a text preview from page 1, and the \`next\` suggestions.

  Four separate readings produce that summary — the document information, the text of page 1, the image count, and the extractability observation — and any of them can fail on its own. \`scope\` says which were done. A field whose reading did not happen is \`null\`, never \`0\`, \`false\` or \`""\`: "not read" and "read and found nothing" are different answers, and \`next\` stays silent about any premise that was not observed.

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
      // 🔴 4 つの読みは別々に失敗しうる。Promise.all に入れると、先に失敗した
      // ものの理由だけが残り、ほかの 3 つの答えが捨てられる。
      // 3 つは同じ pdfjs の文書から取るので、文書が開けなければ 3 つとも同じ理由になる。
      const docHalf = await half(() => loadDocument(params.file_path));
      let metadataOutcome: PartOutcome = docHalf.outcome;
      let previewOutcome: PartOutcome = docHalf.outcome;
      let imagesOutcome: PartOutcome = docHalf.outcome;
      let metadata: PdfMetadata | null = null;
      let textPreview: string | null = null;
      let imageCount: number | null = null;

      if (docHalf.ok) {
        const doc = docHalf.value;
        try {
          const [m, t, i] = await Promise.all([
            half(() => getMetadataFromDoc(doc, params.file_path)),
            half(() => extractTextFromDoc(doc, '1')),
            half(() => countImagesFromDoc(doc)),
          ]);
          metadataOutcome = m.outcome;
          previewOutcome = t.outcome;
          imagesOutcome = i.outcome;
          metadata = m.ok ? m.value : null;
          textPreview = t.ok ? (t.value[0]?.text?.slice(0, 500) ?? '') : null;
          imageCount = i.ok ? i.value : null;
        } finally {
          await doc.destroy();
        }
      }

      // #21: over ALL pages, not just page 1. `hasText` is decided from the
      // first page's preview, so a document whose page 1 happens to carry a
      // title would otherwise report "has text" for 400 scanned pages behind it.
      const obs = await half(() => observeExtractability(params.file_path));

      const scope: SummaryScope = {
        metadata: metadataOutcome,
        textPreview: previewOutcome,
        imageCount: imagesOutcome,
        extractabilityObservation: obs.outcome,
      };

      // どれ 1 つ読めなかったときだけ、エラーにする。
      if (!docHalf.ok && !obs.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(bothFailedError(docHalf.error, obs.error), null, 2),
            },
          ],
          isError: true,
        };
      }

      const observations = obs.ok ? obs.value : null;
      const textExtractability = observations ? foldExtractability(observations) : null;
      const unreadablePages = observations
        ? observations.filter((page) => page.state !== 'extracted')
        : null;

      const summary: PdfSummary = {
        filePath: params.file_path,
        scope,
        metadata,
        textPreview,
        imageCount,
        // 🔴 1 ページ目の文字を読めていないなら、文字があるともないとも言えない。
        hasText: textPreview === null ? null : textPreview.trim().length > 0,
        textExtractability,
        unreadablePages,
        next: suggestNext(metadata, textExtractability, unreadablePages),
      };

      const text =
        params.response_format === ResponseFormat.JSON
          ? JSON.stringify(summary, null, 2)
          : [...formatSummaryScope(scope), '', formatSummaryMarkdown(summary)].join('\n');

      return {
        content: [{ type: 'text' as const, text }],
      };
    },
  );
}
