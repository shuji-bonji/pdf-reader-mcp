/**
 * search_text - Full-text search within a PDF.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type SearchTextInput, SearchTextSchema } from '../../schemas/tier1.js';
import { searchText } from '../../services/pdfjs-service.js';
import type { SearchResult } from '../../types.js';
import { handleStructuredError } from '../../utils/error-handler.js';
import { formatSearchResultMarkdown } from '../../utils/formatter.js';

export function registerSearchText(server: McpServer): void {
  server.registerTool(
    'search_text',
    {
      title: 'Search PDF Text',
      description: `Search for text within a PDF document. Returns matching locations with surrounding context.

Case-insensitive search across all or specified pages. Each match includes the page number, the matched text, and configurable surrounding context.

The search runs over the same text \`read_text\` returns, so \`/ActualText\` replacements (ISO 32000-2 §14.9.4) match: a word carried as ActualText (ligature substitutes, hyphenation fixes) is found under the spelling a viewer shows, not under its glyph form. Rarely, a page's marked content cannot be aligned with the extracted text and the replacement is left unresolved; when that happens on a search with no hits, the result carries a \`note\` naming those pages.

Args:
  - file_path (string): Absolute path to a local PDF file
  - query (string): Text to search for (case-insensitive, 1-500 chars)
  - pages (string, optional): Page range to search. Omit for all pages.
  - context_chars (number): Characters of context before/after match (default: 80)
  - max_results (number): Maximum matches to return (default: 20, max: 100)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Search matches with page number, matched text, and surrounding context.

Examples:
  - Search entire PDF: { file_path: "/path/to/doc.pdf", query: "digital signature" }
  - Search specific pages: { file_path: "/path/to/doc.pdf", query: "error", pages: "1-10" }`,
      inputSchema: SearchTextSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: SearchTextInput) => {
      try {
        const {
          matches: allMatches,
          unresolvedPages,
          unresolvedReason,
        } = await searchText(params.file_path, params.query, params.context_chars, params.pages);

        const truncated = allMatches.length > params.max_results;
        const matches = allMatches.slice(0, params.max_results);

        const result: SearchResult = {
          query: params.query,
          totalMatches: allMatches.length,
          matches,
          truncated,
        };

        // #18 resolves /ActualText, so the blanket #15 warning no longer
        // applies — but the resolution can still be skipped. Keep saying so,
        // now only where it is actually true, and say which of the two reasons
        // it is: they call for different next steps, and pointing an encrypted
        // document at extract_structured_text would waste the caller's time
        // (that tool reads its replacement text through pdf-lib as well).
        if (allMatches.length === 0 && unresolvedPages.length > 0) {
          result.note =
            unresolvedReason === 'encrypted'
              ? 'No matches. This document is encrypted, so replacement text (/ActualText, ' +
                'ISO 32000-2 §14.9.4) could not be read: §7.6.2 encrypts strings and streams, ' +
                'and this server does not decrypt them. What was searched is the glyphs as ' +
                'drawn. No other tool here will do better — decrypt the file first if you ' +
                'need the replacement text.'
              : 'No matches. Replacement text (/ActualText, ISO 32000-2 §14.9.4) was resolved, ' +
                `except on page(s) ${unresolvedPages.join(', ')}, whose content stream could not ` +
                'be aligned with the extracted text. A Span-level replacement there would be ' +
                'invisible to this search — try extract_structured_text if the document is tagged.';
        }

        const text =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(result, null, 2)
            : formatSearchResultMarkdown(result);

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
