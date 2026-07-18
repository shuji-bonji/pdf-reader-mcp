/**
 * extract_structured_text - structure-preserving text extraction (M-8).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import {
  type ExtractStructuredTextInput,
  ExtractStructuredTextSchema,
} from '../../schemas/tier2.js';
import { extractStructuredText } from '../../services/struct-tree-service.js';
import { handleStructuredError } from '../../utils/error-handler.js';
import { formatStructuredTextMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerExtractStructuredText(server: McpServer): void {
  server.registerTool(
    'extract_structured_text',
    {
      title: 'Extract Structured Text',
      description: `Extract a tagged PDF's text in logical content order, with each piece labelled by its structure type.

This answers "what is the text of the H1?" — which read_text (flat, coordinate order),
inspect_tags (structure, no text) and extract_tables (text, tables only) each cannot.

Args:
  - file_path (string): Absolute path to a local PDF file
  - pages (string, optional): Page range ("1-5", "3", "1,3,5-7"). Omit for all pages.
    An element that touches the range is returned whole, even if it continues outside it.
  - roles (string[], optional): Structure types to include, e.g. ["H1","H2"] for an outline
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  isTagged, the document language, and a flat list of elements in logical content order.
  Each element has: role, depth (nesting; top level is 0), text, pages, and optionally
  alt / label / rows.

  The list is flat with a depth field rather than nested — a depth-first pre-order plus
  depth encodes the tree exactly, so nothing is lost. Table is the exception and carries
  rows, because a table is two-dimensional and depth cannot express "row 2, column 3".

Key properties:
  - Order is a depth-first traversal of the document's structure tree, which is how
    ISO 32000-2 §14.8.2.5 defines logical content order.
  - An element that spans pages stays ONE element (pages is an array). A paragraph
    split across a page break is returned as one paragraph, not two.
  - ActualText replaces the glyphs when present (§14.9.4: "a replacement, not a
    description"). Alt is reported separately in alt and never as text — it describes
    content that has no text (§14.9.3), so it must not leak into the body.
  - Lbl (a list bullet or number) is reported in label, not mixed into text.
  - Artifacts (page numbers, running heads) are excluded: §14.8.2.5 NOTE 3 puts them
    outside the logical content order.

Untagged PDFs return isTagged: false with a reason and no elements. Nothing is guessed
from coordinates — §14.8.2.5 NOTE 1 is explicit that page order need not match logical
order, so a guess could not be trusted. To add a structure scaffold, use pdf-writer-mcp
ensure_tagged and retry.

Examples:
  - Extract a document outline: { file_path: "/doc.pdf", roles: ["H1","H2","H3"] }
  - Get content for reflow / conversion, structure preserved: { file_path: "/doc.pdf" }
  - Read the text of a specific section's pages: { file_path: "/doc.pdf", pages: "4-6" }`,
      inputSchema: ExtractStructuredTextSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ExtractStructuredTextInput) => {
      try {
        const result = await extractStructuredText(params.file_path, {
          pages: params.pages,
          roles: params.roles,
        });

        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(result, null, 2)
            : formatStructuredTextMarkdown(result);

        const { text } = truncateIfNeeded(raw);
        return { content: [{ type: 'text' as const, text }] };
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
