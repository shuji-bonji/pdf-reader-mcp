/**
 * Zod schemas for Tier 3 tools.
 */

import { z } from 'zod';
import { FilePathSchema, ResponseFormatSchema } from './common.js';

/** compare_structure */
export const CompareStructureSchema = z
  .object({
    file_path_1: FilePathSchema.describe('Absolute path to the first PDF file for comparison'),
    file_path_2: FilePathSchema.describe('Absolute path to the second PDF file for comparison'),
    response_format: ResponseFormatSchema,
  })
  .strict();

// Export inferred types
export type CompareStructureInput = z.infer<typeof CompareStructureSchema>;
