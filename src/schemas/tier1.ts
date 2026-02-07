/**
 * Zod schemas for Tier 1 tools.
 */

import { z } from 'zod';
import { DEFAULT_SEARCH_CONTEXT, MAX_SEARCH_RESULTS } from '../constants.js';
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

/** read_text */
export const ReadTextSchema = z
  .object({
    file_path: FilePathSchema,
    pages: PagesSchema,
    response_format: ResponseFormatSchema,
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

/** read_images */
export const ReadImagesSchema = z
  .object({
    file_path: FilePathSchema,
    pages: PagesSchema,
  })
  .strict();

/** read_url */
export const ReadUrlSchema = z
  .object({
    url: UrlSchema,
    pages: PagesSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

/** summarize */
export const SummarizeSchema = z
  .object({
    file_path: FilePathSchema,
    response_format: ResponseFormatSchema,
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
