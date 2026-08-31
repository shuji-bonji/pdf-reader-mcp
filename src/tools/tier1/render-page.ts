/**
 * render_page - Rasterise PDF pages to PNG or JPEG (#23).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { MAX_IMAGE_RESPONSE_BYTES } from '../../constants.js';
import { type RenderPageInput, RenderPageSchema } from '../../schemas/tier1.js';
import {
  DEFAULT_RENDER_DPI,
  RENDERER_MISSING_MESSAGE,
  rendererAvailable,
  renderPages,
} from '../../services/page-renderer.js';
import { handleStructuredError } from '../../utils/error-handler.js';

export function registerRenderPage(server: McpServer): void {
  server.registerTool(
    'render_page',
    {
      title: 'Render PDF Page',
      description: `Rasterise pages of a PDF to PNG or JPEG images, returned as MCP image content blocks.

This is the tool for documents whose text cannot be read as text: pages \`read_text\` reports as \`no_text_layer\` or \`not_extractable\`, vector drawings, forms, handwriting, stamps. It draws the PAGE — everything on it — where \`read_images\` only extracts the image XObjects a page happens to embed.

Rendering uses PDFium compiled to WebAssembly (optional dependency \`@hyzyla/pdfium\`). Note this is a different engine from the pdf.js this server reads text with; where their behaviour on a damaged file differs, neither output is evidence about the other. If the dependency is not installed, this tool says so and every other tool works normally.

\`pages\` is required — rendering is the most expensive operation here, and "all pages" of a large scan should be a decision, not a default. The response carries at most ${(MAX_IMAGE_RESPONSE_BYTES / (1024 * 1024)).toFixed(0)} MB of encoded images; pages past the budget are named with the reason, not dropped.

Args:
  - file_path (string): Absolute path to a local PDF file
  - pages (string, REQUIRED): Page range: "1-3", "5", "1,3,5-7".
  - dpi (36-600, optional): Density, default ${DEFAULT_RENDER_DPI}. 150 reads well; 300 for small print.
  - max_width (number, optional): Pixel-width cap; wins over dpi when smaller.
  - format ('png' | 'jpeg', optional): Default 'png'. 'jpeg' is usually right for scans.
  - quality (1-100, optional): JPEG quality.

Returns:
  A text block with per-page metadata (point size, pixel size, effective dpi, bytes) and any omissions, then one image content block per rendered page.

Rasterising a page can take unbounded time — a tiling pattern (ISO 32000-2 §8.7.3.1) whose \`/XStep\` or \`/YStep\` is a near-zero magnitude asks for an astronomical number of tiles, and the clause forbids only zero. Each page therefore gets 20 seconds (\`PDF_READER_RENDER_TIMEOUT_MS\` overrides it); the rendering runs off the main thread, so a page that does not finish is stopped and named in the omissions rather than taking the server down with it. The pages rendered before it are still returned, and the pages after it are reported separately as not attempted — "could not be rendered" and "never started" are different answers.

Examples:
  - A scanned page: { file_path: "/path/to/scan.pdf", pages: "1", format: "jpeg" }
  - A diagram at high detail: { file_path: "/path/to/doc.pdf", pages: "3", dpi: 300 }`,
      inputSchema: RenderPageSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: RenderPageInput) => {
      try {
        if (!(await rendererAvailable())) {
          return {
            content: [{ type: 'text' as const, text: RENDERER_MISSING_MESSAGE }],
            isError: true,
          };
        }

        const result = await renderPages(params.file_path, params.pages, {
          dpi: params.dpi,
          maxWidth: params.max_width,
          format: params.format,
          quality: params.quality,
        });

        const lines: string[] = [];
        if (result.pages.length === 0) {
          lines.push('No pages were rendered.');
        } else {
          lines.push(
            `Rendered ${result.pages.length} page(s), ` +
              `${result.totalEncodedBytes.toLocaleString()} bytes encoded.`,
            '',
            '| Page | Size (pt) | Rendered (px) | Effective dpi | Type | Bytes |',
            '|---|---|---|---|---|---|',
          );
          for (const page of result.pages) {
            lines.push(
              `| ${page.page} | ${page.pointWidth}×${page.pointHeight} | ` +
                `${page.width}×${page.height} | ${page.effectiveDpi} | ${page.mimeType} | ` +
                `${page.encodedBytes.toLocaleString()} |`,
            );
          }
        }
        if (result.omitted.length > 0) {
          lines.push('', '## Not rendered', '');
          for (const omitted of result.omitted) {
            lines.push(`- page ${omitted.page}: ${omitted.reason}`);
          }
        }

        return {
          content: [
            { type: 'text' as const, text: lines.join('\n') },
            ...result.pages.map((page) => ({
              type: 'image' as const,
              data: page.dataBase64,
              mimeType: page.mimeType,
            })),
          ],
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
