/**
 * search_text - Full-text search within a PDF.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type SearchTextInput, SearchTextSchema } from '../../schemas/tier1.js';
import { searchText } from '../../services/pdfjs-service.js';
import type { SearchResult } from '../../types.js';
import { handleError } from '../../utils/error-handler.js';
import { formatSearchResultMarkdown } from '../../utils/formatter.js';

export function registerSearchText(server: McpServer): void {
  server.registerTool(
    'search_text',
    {
      title: 'Search PDF Text',
      description: `Search for text within a PDF document. Returns matching locations with surrounding context.

Case-insensitive search across all or specified pages. Each match includes the page number, the matched text, and configurable surrounding context.

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
        const allMatches = await searchText(
          params.file_path,
          params.query,
          params.context_chars,
          params.pages,
        );

        const truncated = allMatches.length > params.max_results;
        const matches = allMatches.slice(0, params.max_results);

        const result: SearchResult = {
          query: params.query,
          totalMatches: allMatches.length,
          matches,
          truncated,
        };

        const text =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(result, null, 2)
            : formatSearchResultMarkdown(result);

        return {
          content: [{ type: 'text' as const, text }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: handleError(error) }],
        };
      }
    },
  );
}
