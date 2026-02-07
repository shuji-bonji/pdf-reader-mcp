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

/** inspect_signatures */
export const InspectSignaturesSchema = z
  .object({
    file_path: FilePathSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

// Export inferred types
export type InspectStructureInput = z.infer<typeof InspectStructureSchema>;
export type InspectTagsInput = z.infer<typeof InspectTagsSchema>;
export type InspectFontsInput = z.infer<typeof InspectFontsSchema>;
export type InspectAnnotationsInput = z.infer<typeof InspectAnnotationsSchema>;
export type InspectSignaturesInput = z.infer<typeof InspectSignaturesSchema>;
