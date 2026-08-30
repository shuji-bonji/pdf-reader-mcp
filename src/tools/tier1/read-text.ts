/**
 * read_text - Text extraction with Y-coordinate-based reading order.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { ResponseFormat } from '../../constants.js';
import { type ReadTextInput, ReadTextSchema } from '../../schemas/tier1.js';
import { extractText } from '../../services/pdfjs-service.js';
import { bothFailedError, bothHalves, formatReadingScope } from '../../services/reading-scope.js';
import {
  byPage,
  observeExtractability,
  summarizeExtractability,
} from '../../services/text-extractability-service.js';
import type { PageText } from '../../types.js';
import { formatPageTextsMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerReadText(server: McpServer): void {
  server.registerTool(
    'read_text',
    {
      title: 'Read PDF Text',
      description: `Extract text content from a PDF document with Y-coordinate-based reading order preservation.

Text is extracted page by page, sorted by vertical position (top to bottom) then horizontal position (left to right), providing natural reading order.

\`/ActualText\` replacements (ISO 32000-2 §14.9.4) are resolved, on both of the paths that clause defines: the \`/ActualText\` of a structure element, and the one in a \`Span\` marked-content property list — the latter occurs in untagged documents too. So a word carried as ActualText (ligature substitutes, hyphenation fixes) reads here the way a person viewing the page sees it, not in its glyph form.

For **tagged** PDFs, \`extract_structured_text\` is still the better tool when order matters: it returns text in logical content order (ISO 32000-2 §14.8.2.5), which this tool does not — read_text sorts by coordinate. Tables in tagged PDFs are best read with \`extract_tables\`.

For **untagged** multi-column PDFs (e.g. older 新旧対照表 PDFs that lack a structure tree), pass \`split_columns: 2\` or \`3\` to bucket items by X-coordinate left-to-right.

For Japanese form-style PDFs (帳票・様式) where U+3000 fullwidth spaces are used as visual indentation, pass \`compact_whitespace: true\` to collapse runs of whitespace to a single ASCII space. Cuts 20–40% of token consumption without losing content.

Args:
  - file_path (string): Absolute path to a local PDF file
  - pages (string, optional): Page range to extract. Format: "1-5", "3", or "1,3,5-7". **Omitting it means ALL pages** — on a large document that consumes the whole response budget in one call. Past ~50 pages, search_text first and pass an explicit range here.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')
  - split_columns (1 | 2 | 3, optional): Column-aware reordering for untagged multi-column PDFs. Default 1 = existing Y-sort.
  - compact_whitespace (boolean, optional): Collapse whitespace runs (incl. U+3000) to one ASCII space and trim each line. Default false.

Every page also reports how much of its text could be converted to Unicode (ISO 32000-2 §9.10.1): \`extracted\`, \`no_text_layer\` (no text-showing operator, image content present — reading it needs OCR or a rendered page), \`not_extractable\` (a font used here offers no route to Unicode, so text is missing or wrong), or \`not_observed\` (encrypted or unreadable content stream). An empty result is therefore never by itself evidence that a page has no text.

Two separate readings produce that answer: taking the characters off the page, and observing whether those characters have a route to Unicode. Either can fail on its own, so the response says which of the two was done, under \`scope\`. When the characters were taken but the observation could not run, the text is still returned and \`extractability\` is left off the pages — absent is not \`extracted\`. When the characters could not be taken but the observation ran, \`text\` is \`null\` (not \`""\`, which would say the page has no text) and the per-page observation still tells you whether the page has any text-showing operator at all. Only when neither reading could be done is this an error, and it then names both reasons.

Returns:
  \`{ scope, pages }\`. \`pages\` is the extracted text organized by page number, preceded by the extractability tally. With \`split_columns >= 2\`, columns are separated by a blank line so a downstream LLM can tell them apart.

Examples:
  - Extract all text: { file_path: "/path/to/doc.pdf" }
  - Untagged 新旧対照表: { file_path: "/path/to/older-shinkyu.pdf", split_columns: 2 }
  - Japanese form template: { file_path: "/path/to/form.pdf", compact_whitespace: true }`,
      inputSchema: ReadTextSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ReadTextInput) => {
      // 🔴 2 本を Promise.all に入れない。先に失敗したほうの理由だけが残り、
      // もう片方の答えが捨てられる（0.13.0 まではそうなっていた）。
      const {
        text: extraction,
        observation,
        scope,
      } = await bothHalves(
        () =>
          extractText(params.file_path, params.pages, {
            splitColumns: params.split_columns,
            compactWhitespace: params.compact_whitespace,
          }),
        // #21: an empty (or shortened) result is not evidence that the page
        // has no text. The state says which of the three §9.10.1 conditions
        // produced what is above it.
        () => observeExtractability(params.file_path, params.pages),
      );

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
      const pages: PageText[] = extraction.ok
        ? extraction.value.map((page) => ({
            ...page,
            ...(observed.has(page.page) ? { extractability: observed.get(page.page) } : {}),
          }))
        : // 文字は取り出せなかった。ページの一覧は観測側から取る。
          // text は null —— '' と書くと「このページに文字は無い」と言ったことになる。
          observations.map((o) => ({ page: o.page, text: null, extractability: o }));

      let text: string;
      if (params.response_format === ResponseFormat.JSON) {
        text = JSON.stringify({ scope, pages }, null, 2);
      } else {
        const banner = observation.ok ? summarizeExtractability(observations) : [];
        text = [
          ...formatReadingScope(scope),
          '',
          ...banner,
          '',
          formatPageTextsMarkdown(pages),
        ].join('\n');
      }

      const { text: finalText } = truncateIfNeeded(text);

      return {
        content: [{ type: 'text' as const, text: finalText }],
      };
    },
  );
}
