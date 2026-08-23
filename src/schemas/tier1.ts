/**
 * Zod schemas for Tier 1 tools.
 */

import { z } from 'zod';
import { DEFAULT_IMAGE_QUALITY, DEFAULT_SEARCH_CONTEXT, MAX_SEARCH_RESULTS } from '../constants.js';
import { FilePathSchema, PagesSchema, ResponseFormatSchema, UrlSchema } from './common.js';

/** get_page_count */
export const GetPageCountSchema = z
  .object({
    file_path: FilePathSchema,
  })
  .strict();

/** get_metadata */
export const GetMetadataSchema = z
  .object({
    file_path: FilePathSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

/**
 * `split_columns` — Issue #3: column-aware extraction for untagged
 * multi-column PDFs.
 *
 * Acts as an opt-in override for the default reading-order strategy. When
 * `>= 2`, items are bucketed by X-coordinate into N equal-width columns and
 * the buckets are concatenated left-to-right. `1` (default) preserves the
 * existing Y-sort behaviour. Tagged PDFs with proper `<Table>` markup should
 * use `extract_tables` instead — `split_columns` is for untagged cases.
 */
export const SplitColumnsSchema = z
  .number()
  .int()
  .min(1)
  .max(3)
  .optional()
  .describe(
    'Number of columns to use when reordering text. 1 (default) = existing Y-sort. ' +
      '2 or 3 = bucket by X-coordinate left-to-right. Use for untagged 新旧対照表 / ' +
      'two-column PDFs where Y-sort would interleave columns. Tagged PDFs with proper ' +
      '<Table> markup should use extract_tables instead.',
  );

/**
 * `compact_whitespace` — Issue #4: collapse runs of ASCII / fullwidth
 * whitespace down to a single ASCII space, and trim each line.
 *
 * Default `false` keeps the existing extraction byte-for-byte. When set to
 * `true`, every run of `\s` plus `　` is replaced with one ASCII space
 * and trailing/leading whitespace is removed line by line. This typically
 * cuts 20–40% of token consumption for Japanese form-style PDFs without
 * losing any content. Inter-column blank-line separators (from
 * `split_columns`) are preserved.
 */
export const CompactWhitespaceSchema = z
  .boolean()
  .optional()
  .describe(
    'When true, collapse runs of whitespace (incl. fullwidth space U+3000) ' +
      'to a single ASCII space and trim each line. Reduces token consumption ' +
      'on Japanese form-style PDFs. Default: false (no whitespace normalization).',
  );

/** read_text */
export const ReadTextSchema = z
  .object({
    file_path: FilePathSchema,
    pages: PagesSchema,
    response_format: ResponseFormatSchema,
    split_columns: SplitColumnsSchema,
    compact_whitespace: CompactWhitespaceSchema,
  })
  .strict();

/** search_text */
export const SearchTextSchema = z
  .object({
    file_path: FilePathSchema,
    query: z
      .string()
      .min(1, 'Search query is required')
      .max(500, 'Query must not exceed 500 characters')
      .describe('Text to search for (case-insensitive)'),
    pages: PagesSchema,
    context_chars: z
      .number()
      .int()
      .min(0)
      .max(500)
      .default(DEFAULT_SEARCH_CONTEXT)
      .describe('Number of characters to show before and after each match'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(MAX_SEARCH_RESULTS)
      .default(20)
      .describe('Maximum number of matches to return'),
    response_format: ResponseFormatSchema,
  })
  .strict();

/**
 * `read_images` — Issue #22: the response is now real image files, and its size
 * is bounded.
 *
 * `format` defaults to PNG because PNG is lossless: an image extracted for
 * inspection should not have JPEG artefacts added on the way out. `quality`
 * exists for the case where the caller would rather have a smaller response,
 * and is ignored for PNG rather than silently doing nothing surprising.
 */
export const ReadImagesSchema = z
  .object({
    file_path: FilePathSchema,
    pages: PagesSchema,
    format: z
      .enum(['png', 'jpeg'])
      .optional()
      .describe(
        'Encoding of the returned images. png (default) is lossless; jpeg is smaller and ' +
          'drops alpha (composited over white).',
      ),
    quality: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe(
        `JPEG quality 1-100 (default ${DEFAULT_IMAGE_QUALITY}). Ignored when format is png.`,
      ),
    max_width: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional()
      .describe(
        'Downscale images wider than this, averaging over the source pixels. Images are ' +
          'never enlarged. Omit to return each image at its own size.',
      ),
    max_height: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional()
      .describe('Downscale images taller than this. Never enlarges.'),
  })
  .strict();

/** read_url */
export const ReadUrlSchema = z
  .object({
    url: UrlSchema,
    pages: PagesSchema,
    response_format: ResponseFormatSchema,
    split_columns: SplitColumnsSchema,
    compact_whitespace: CompactWhitespaceSchema,
  })
  .strict();

/** summarize */
export const SummarizeSchema = z
  .object({
    file_path: FilePathSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

/**
 * `render_page` — Issue #23: rasterise pages for documents whose text cannot
 * be read as text.
 *
 * `pages` is REQUIRED, unlike every other tool here. Rendering is the most
 * expensive thing this server does, and "all pages" of a 500-page scan is
 * never what a caller means; making the range explicit keeps the cost a
 * decision instead of a default.
 */
export const RenderPageSchema = z
  .object({
    file_path: FilePathSchema,
    pages: z
      .string()
      .min(1, 'Page range is required — e.g. "1-3", "5", "1,3,5-7"')
      .describe('Page range to render. Required: rendering all pages is never implicit.'),
    dpi: z
      .number()
      .int()
      .min(36)
      .max(600)
      .optional()
      .describe('Rasterisation density (default 150). PDF points are 1/72 inch.'),
    max_width: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional()
      .describe('Cap on the rendered width in pixels; wins over dpi when smaller.'),
    format: z
      .enum(['png', 'jpeg'])
      .optional()
      .describe('png (default, lossless) or jpeg (smaller — usually right for scans).'),
    quality: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe(`JPEG quality 1-100 (default ${DEFAULT_IMAGE_QUALITY}). Ignored for png.`),
  })
  .strict();

// Export inferred types
export type GetPageCountInput = z.infer<typeof GetPageCountSchema>;
export type GetMetadataInput = z.infer<typeof GetMetadataSchema>;
export type ReadTextInput = z.infer<typeof ReadTextSchema>;
export type SearchTextInput = z.infer<typeof SearchTextSchema>;
export type ReadImagesInput = z.infer<typeof ReadImagesSchema>;
export type ReadUrlInput = z.infer<typeof ReadUrlSchema>;
export type SummarizeInput = z.infer<typeof SummarizeSchema>;
export type RenderPageInput = z.infer<typeof RenderPageSchema>;
