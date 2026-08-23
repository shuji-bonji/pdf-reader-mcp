/**
 * read_images - Extract images from PDF pages as PNG or JPEG (#22).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MAX_IMAGE_RESPONSE_BYTES } from '../../constants.js';
import { type ReadImagesInput, ReadImagesSchema } from '../../schemas/tier1.js';
import { extractImages } from '../../services/pdfjs-service.js';
import { handleStructuredError } from '../../utils/error-handler.js';

export function registerReadImages(server: McpServer): void {
  server.registerTool(
    'read_images',
    {
      title: 'Read PDF Images',
      description: `Extract embedded images from a PDF document as PNG or JPEG files.

Each image is returned as an MCP image content block, so a vision-capable model can look at it directly. A text block lists the metadata for all of them (page, index, size in the file, size returned, colour space, encoded bytes).

These are the image XObjects the page draws, not a picture of the page. A page whose content is vector drawing, or whose text is what you want to see, is not covered by this tool.

Response size is bounded: at most ${(MAX_IMAGE_RESPONSE_BYTES / (1024 * 1024)).toFixed(0)} MB of encoded image data per call. Images beyond the budget are named in the text block with the reason and are not returned — nothing is dropped silently. A 200 dpi A4 scan is ~11.6 MB of pixels on its own, so pass \`pages\`, \`max_width\` or \`max_height\` when working with scans.

Args:
  - file_path (string): Absolute path to a local PDF file
  - pages (string, optional): Page range. Format: "1-5", "3", or "1,3,5-7". **Omitting it means ALL pages** — on an image-heavy document that exhausts the byte budget immediately. Name the pages you need.
  - format ('png' | 'jpeg', optional): Output encoding. Default 'png' (lossless). 'jpeg' is smaller and composites alpha over white.
  - quality (1-100, optional): JPEG quality. Ignored for PNG.
  - max_width (number, optional): Downscale images wider than this (area average). Never enlarges.
  - max_height (number, optional): Downscale images taller than this.

Returns:
  A text block with the metadata table and any omissions, then one image content block per returned image.

Examples:
  - Extract all images: { file_path: "/path/to/doc.pdf" }
  - A scanned page, small enough to look at: { file_path: "/path/to/scan.pdf", pages: "1", max_width: 1200, format: "jpeg" }`,
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
        const result = await extractImages(params.file_path, params.pages, {
          format: params.format,
          quality: params.quality,
          maxWidth: params.max_width,
          maxHeight: params.max_height,
        });

        if (result.extractedCount === 0) {
          const lines: string[] = [];
          if (result.detectedCount === 0) {
            lines.push('No images found in the specified pages.');
          } else {
            lines.push(`${result.detectedCount} image(s) detected in the PDF.`);
            if (result.skippedCount > 0) {
              // Don't guess at a cause. The previous wording blamed "an
              // encoding format that is not directly accessible", which was
              // reported even for ordinary images pdfjs decodes perfectly —
              // the real cause was a bug in this server, and the confident
              // explanation made it look like a property of the file.
              lines.push(
                `${result.skippedCount} could not be decoded. This can happen with image types ` +
                  'pdf.js does not decode outside a rendering context (for example some masks ' +
                  'and JPX/JBIG2 streams).',
              );
            }
            for (const omitted of result.omitted) {
              lines.push(
                `- page ${omitted.page}, image ${omitted.index} ` +
                  `(${omitted.sourceWidth}×${omitted.sourceHeight}): ${omitted.reason}`,
              );
            }
          }
          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        }

        const lines: string[] = [
          `Returning ${result.extractedCount} image(s), ` +
            `${result.totalEncodedBytes.toLocaleString()} bytes encoded.`,
          '',
          '| Page | Index | In file | Returned | Colour space | Bits | Type | Bytes |',
          '|---|---|---|---|---|---|---|---|',
        ];
        for (const image of result.images) {
          const returnedSize = image.downscaled
            ? `${image.width}×${image.height} (downscaled)`
            : `${image.width}×${image.height}`;
          lines.push(
            `| ${image.page} | ${image.index} | ${image.sourceWidth}×${image.sourceHeight} | ` +
              `${returnedSize} | ${image.colorSpace} | ${image.bitsPerComponent} | ` +
              `${image.mimeType} | ${image.encodedBytes.toLocaleString()} |`,
          );
        }

        if (result.skippedCount > 0) {
          lines.push('', `${result.skippedCount} further image(s) could not be decoded by pdf.js.`);
        }
        if (result.omitted.length > 0) {
          lines.push('', '## Not returned', '');
          for (const omitted of result.omitted) {
            lines.push(
              `- page ${omitted.page}, image ${omitted.index} ` +
                `(${omitted.sourceWidth}×${omitted.sourceHeight}): ${omitted.reason}`,
            );
          }
        }

        return {
          content: [
            { type: 'text' as const, text: lines.join('\n') },
            ...result.images.map((image) => ({
              type: 'image' as const,
              data: image.dataBase64,
              mimeType: image.mimeType,
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
