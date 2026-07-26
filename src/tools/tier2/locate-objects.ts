/**
 * locate_objects - object number → page and rectangle (Issue #20).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseFormat } from '../../constants.js';
import { type LocateObjectsInput, LocateObjectsSchema } from '../../schemas/tier2.js';
import { locateObjects } from '../../services/object-locator.js';
import { handleStructuredError } from '../../utils/error-handler.js';
import { formatObjectLocationsMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerLocateObjects(server: McpServer): void {
  server.registerTool(
    'locate_objects',
    {
      title: 'Locate PDF Objects (object number → page and rectangle)',
      description: `Report where the given objects sit on the page.

Bridges "which object" to "which coordinates": pdf-verify-mcp's verify_integrity names the objects an incremental update changed, and pdf-writer-mcp's add_annotation wants a page number and a rectangle. The rectangle is returned in PDF user space (origin bottom-left, pt, x1 < x2 and y1 < y2 — ISO 32000-1 §7.9.5 normalised form), which is exactly what add_annotation takes.

Args:
  - file_path (string): Absolute path to a local PDF file
  - object_numbers (number[]): Object numbers to locate, e.g. [25, 27]
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Per object: whether it exists, its /Type and /Subtype, and the places it occupies, each with the basis the coordinates rest on:
  - annotation-rect — the object's own /Rect. Exact.
  - page-box — the object is a page; the rectangle is its crop/media box.
  - page-content-stream — the object draws the page; the rectangle is the WHOLE page, not the part that changed.
  - page-resource — a font, image or colour space used by the page. No rectangle exists for it.

Limits (observations, not judgements):
  - Narrowing a content stream to the paragraph that moved needs a content-stream walk with graphics state; this tool does not do it and says so rather than inventing a rectangle.
  - An object that does not exist (freed by a later revision) is returned with found: false — not as "no coordinates".
  - In an encrypted document, coordinates and types are still reliable (numbers and names are not encrypted, ISO 32000-1 §7.6.2) but field names are reported as null instead of mojibake.

Examples:
  - Turn verify_integrity's "obj 27 was added after signing" into a page and rectangle
  - Find which page a changed form field widget is on before annotating it`,
      inputSchema: LocateObjectsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: LocateObjectsInput) => {
      try {
        const result = await locateObjects(params.file_path, params.object_numbers);

        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(result, null, 2)
            : formatObjectLocationsMarkdown(result);

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
