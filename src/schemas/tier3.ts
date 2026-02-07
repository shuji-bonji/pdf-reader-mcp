/**
 * Zod schemas for Tier 3 tools.
 */

import { z } from 'zod';
import { FilePathSchema, ResponseFormatSchema } from './common.js';

/** validate_tagged */
export const ValidateTaggedSchema = z
  .object({
    file_path: FilePathSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

/** validate_metadata */
export const ValidateMetadataSchema = z
  .object({
    file_path: FilePathSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

/** compare_structure */
export const CompareStructureSchema = z
  .object({
    file_path_1: FilePathSchema.describe('Absolute path to the first PDF file for comparison'),
    file_path_2: FilePathSchema.describe('Absolute path to the second PDF file for comparison'),
    response_format: ResponseFormatSchema,
  })
  .strict();

// Export inferred types
export type ValidateTaggedInput = z.infer<typeof ValidateTaggedSchema>;
export type ValidateMetadataInput = z.infer<typeof ValidateMetadataSchema>;
export type CompareStructureInput = z.infer<typeof CompareStructureSchema>;
