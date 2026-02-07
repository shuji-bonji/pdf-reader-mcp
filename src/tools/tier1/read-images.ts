/**
 * read_images - Extract images from PDF pages.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ReadImagesInput, ReadImagesSchema } from '../../schemas/tier1.js';
import { extractImages } from '../../services/pdfjs-service.js';
import { handleError } from '../../utils/error-handler.js';

export function registerReadImages(server: McpServer): void {
  server.registerTool(
    'read_images',
    {
      title: 'Read PDF Images',
      description: `Extract images from a PDF document as base64-encoded data.

Extracts embedded images from specified or all pages. Returns image metadata (dimensions, color space) along with raw pixel data in base64.

Args:
  - file_path (string): Absolute path to a local PDF file
  - pages (string, optional): Page range. Format: "1-5", "3", or "1,3,5-7". Omit for all pages.

Returns:
  Array of extracted images with: page number, index, width, height, color space (RGB/RGBA/Grayscale), bits per component, and base64-encoded data.

Note: Large images may produce very large responses. Use the pages parameter to limit scope.

Examples:
  - Extract all images: { file_path: "/path/to/doc.pdf" }
  - Extract from page 1: { file_path: "/path/to/doc.pdf", pages: "1" }`,
      inputSchema: ReadImagesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ReadImagesInput) => {
      try {
        const result = await extractImages(params.file_path, params.pages);

        if (result.extractedCount === 0) {
          if (result.skippedCount > 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    `${result.detectedCount} image(s) detected in the PDF, ` +
                    'but none could be extracted. ' +
                    'The images may use an encoding format that is not directly accessible.',
                },
              ],
            };
          }
          return {
            content: [{ type: 'text' as const, text: 'No images found in the specified pages.' }],
          };
        }

        // Build response with full image data including base64
        const imagesWithData = result.images.map((img) => ({
          page: img.page,
          index: img.index,
          width: img.width,
          height: img.height,
          colorSpace: img.colorSpace,
          bitsPerComponent: img.bitsPerComponent,
          dataBase64: img.dataBase64,
        }));

        let text = `Found ${result.extractedCount} image(s).`;
        if (result.skippedCount > 0) {
          text += ` (${result.skippedCount} additional image(s) could not be extracted)`;
        }
        text += `\n\n${JSON.stringify(imagesWithData, null, 2)}`;

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
