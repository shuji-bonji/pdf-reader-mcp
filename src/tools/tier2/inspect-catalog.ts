/**
 * inspect_catalog - document-level inventory from the catalog dictionary (#27).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { ResponseFormat } from '../../constants.js';
import { type InspectCatalogInput, InspectCatalogSchema } from '../../schemas/tier2.js';
import { applyXmpPolicy, inspectCatalog } from '../../services/catalog-service.js';
import { handleStructuredError } from '../../utils/error-handler.js';
import { formatCatalogMarkdown, truncateIfNeeded } from '../../utils/formatter.js';

export function registerInspectCatalog(server: McpServer): void {
  server.registerTool(
    'inspect_catalog',
    {
      title: 'Inspect PDF Catalog',
      description: `List the document-level components hanging off the catalog dictionary (ISO 32000-2 §7.7.2, Table 29) — the parts of a PDF that are not page content and that page-oriented readers drop: bookmarks, layers, attachments, the XMP packet, and the actions that run when the document is opened.

Args:
  - file_path (string): Absolute path to a local PDF file
  - max_outline_items (integer, 1-500, default 50): how many bookmark items to list (count and depth cover the whole tree)
  - include_xmp (boolean, default false): also return the XMP packet text (capped at 64 KiB)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns, per entry:
  - outlines (/Outlines, §12.3.3): item count, depth, and the first items with title and target page
  - optionalContent (/OCProperties, §8.11.4): every layer's /Name, and the default configuration's BaseState / ON / OFF counts
  - embeddedFiles (/Names → /EmbeddedFiles, §7.7.4 / §7.11.4): file name, MIME type, size, /AFRelationship, description
  - associatedFiles (/AF, §14.13): count at document level
  - names: counts of the /Dests and /JavaScript name trees (document-level ECMAScript runs on open, §12.6.4.17)
  - metadata (/Metadata, §14.3.2): packet size, namespaces present, and the DECLARED values of pdfaid:*, pdfuaid:part and the W3C TDMRep tdm:reservation / tdm:policy
  - openAction (/OpenAction) and additionalActions (/AA, Table 200): action type (/S), target page or file or URI, whether /JS is present, length of the /Next chain
  - collection (/Collection, §12.3.5): whether the document is a portfolio

Each entry distinguishes { status: "absent" } (the catalog has no such key — an observed fact) from { status: "unreadable", reason } (the key is there but its value could not be reached). An encrypted document whose key cannot be derived reports every entry as unreadable, never as absent.

This tool reports what is written. A pdfuaid:part declaration is a claim about the structure tree, not a verdict on it (that is pdf-verify-mcp validate_conformance); tdm:reservation is the rights holder's statement, and whether to honour it is the caller's decision; an action with /JS is reported, not judged.

Examples:
  - Find out whether a document carries attachments, layers or bookmarks before deciding how to read it
  - Read the XMP declarations (PDF/A, PDF/UA, TDMRep) that get_metadata, which reads the Info dictionary, does not see
  - See what a document will execute when opened (/OpenAction, /AA, document-level JavaScript)`,
      inputSchema: InspectCatalogSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: InspectCatalogInput) => {
      try {
        const inventory = await inspectCatalog(params.file_path, {
          maxOutlineItems: params.max_outline_items,
        });
        const output = applyXmpPolicy(inventory, params.include_xmp);

        const raw =
          params.response_format === ResponseFormat.JSON
            ? JSON.stringify(output, null, 2)
            : formatCatalogMarkdown(output);

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
