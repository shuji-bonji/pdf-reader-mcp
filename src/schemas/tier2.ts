/**
 * Zod schemas for Tier 2 tools.
 */

import { z } from 'zod';
import { FilePathSchema, PagesSchema, ResponseFormatSchema } from './common.js';

/** inspect_structure */
export const InspectStructureSchema = z
  .object({
    file_path: FilePathSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

/** inspect_tags */
export const InspectTagsSchema = z
  .object({
    file_path: FilePathSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

/** inspect_fonts */
export const InspectFontsSchema = z
  .object({
    file_path: FilePathSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

/** inspect_annotations */
export const InspectAnnotationsSchema = z
  .object({
    file_path: FilePathSchema,
    pages: PagesSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

/** extract_structured_text */
export const ExtractStructuredTextSchema = z
  .object({
    file_path: FilePathSchema,
    pages: PagesSchema.describe(
      'Page range to process. Format: "1-5", "3", or "1,3,5-7". Omit for all pages. ' +
        'An element that touches the range is returned whole, even if it continues outside it.',
    ),
    roles: z
      .array(z.string())
      .optional()
      .describe(
        'Structure types to include, e.g. ["H1","H2"] to extract an outline. Omit for all roles.',
      ),
    response_format: ResponseFormatSchema,
  })
  .strict();

/** inspect_signatures */
export const InspectSignaturesSchema = z
  .object({
    file_path: FilePathSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

/** extract_tables — Tagged PDF Table → Markdown */
export const ExtractTablesSchema = z
  .object({
    file_path: FilePathSchema,
    pages: PagesSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

// Export inferred types
export type InspectStructureInput = z.infer<typeof InspectStructureSchema>;
export type InspectTagsInput = z.infer<typeof InspectTagsSchema>;
export type InspectFontsInput = z.infer<typeof InspectFontsSchema>;
export type InspectAnnotationsInput = z.infer<typeof InspectAnnotationsSchema>;
export type InspectSignaturesInput = z.infer<typeof InspectSignaturesSchema>;
export type ExtractTablesInput = z.infer<typeof ExtractTablesSchema>;
export type ExtractStructuredTextInput = z.infer<typeof ExtractStructuredTextSchema>;
