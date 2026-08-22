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
import {
  observeExtractability,
  summarizeExtractability,
} from '../../services/text-extractability-service.js';
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
  - include_bbox (boolean): Also report where each element is drawn (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  isTagged, the document language, and a flat list of elements in logical content order.
  Each element has: role, depth (nesting; top level is 0), text, pages, and optionally
  alt / label / rows / boxes / boxNote.

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

With include_bbox (answers "where is this paragraph?", so an annotation can be placed on it):
  Each element gains boxes — ONE RECTANGLE PER PAGE, because an element that spans pages
  has no single rectangle. Each is { page, rect: {x1,y1,x2,y2}, basis } in PDF default user
  space (origin bottom-left, pt, already normalised), which is exactly what pdf-writer-mcp
  add_annotation takes: no coordinate system has to be reinterpreted in between. /Rotate and
  a shifted /CropBox do not affect it.

  basis says how strong the claim is, and the two are not the same kind of claim:
    - layout-attribute-bbox — the /BBox the file DECLARES for the element (ISO 32000-2
      Table 379). A statement by the producer about its own geometry, reported as-is.
      This is the only source for content that has no text.
    - text-extent — MEASURED from the text the element owns: baseline origin plus the
      font's ascent/descent. That is the line box, not the glyph outlines. Images and
      vector drawings contribute nothing to it.

  When a declared /BBox does not cover the text measured inside it, that disagreement is
  reported in boxNote rather than smoothed over.

  An element with no rectangle has no boxes and carries boxNote saying why — a Figure
  holding one image is the usual case (§14.8.4.8.5: such an element "should have a BBox
  attribute"). Absent is not zero-sized, and neither is guessed at.

Untagged PDFs return isTagged: false with a reason and no elements. Nothing is guessed
from coordinates — §14.8.2.5 NOTE 1 is explicit that page order need not match logical
order, so a guess could not be trusted. To add a structure scaffold, use pdf-writer-mcp
ensure_tagged and retry.

Examples:
  - Extract a document outline: { file_path: "/doc.pdf", roles: ["H1","H2","H3"] }
  - Get content for reflow / conversion, structure preserved: { file_path: "/doc.pdf" }
  - Read the text of a specific section's pages: { file_path: "/doc.pdf", pages: "4-6" }
  - Find where to put an annotation:
    { file_path: "/doc.pdf", roles: ["P"], include_bbox: true } → hand a box straight to
    pdf-writer-mcp add_annotation. To go the other way, from an object number a diff
    reported to a rectangle, use locate_objects.`,
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
        const [result, observations] = await Promise.all([
          extractStructuredText(params.file_path, {
            pages: params.pages,
            roles: params.roles,
            includeBbox: params.include_bbox,
          }),
          // #21: logical order does not make characters convertible. A tagged
          // page drawn with an Identity-H font that has no /ToUnicode returns a
          // correct tree over unreadable text, and that has to be visible here
          // too — otherwise this is the one path that still hides it.
          observeExtractability(params.file_path, params.pages),
        ]);
        result.extractability = observations;

        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(result, null, 2)
            : [
                ...summarizeExtractability(observations),
                '',
                formatStructuredTextMarkdown(result),
              ].join('\n');

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
