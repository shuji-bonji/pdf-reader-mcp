/**
 * Common Zod schemas shared across tools.
 */

import { z } from 'zod';
import { ResponseFormat } from '../constants.js';

/** File path parameter for local PDF files */
export const FilePathSchema = z
  .string()
  .min(1, 'File path is required')
  .describe('Absolute path to a local PDF file (e.g., "/path/to/document.pdf")');

/** Optional page range parameter */
export const PagesSchema = z
  .string()
  .optional()
  .describe('Page range to process. Format: "1-5", "3", or "1,3,5-7". Omit for all pages.');

/** Response format parameter */
export const ResponseFormatSchema = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe('Output format: "markdown" for human-readable, "json" for structured data');

/** URL parameter for remote PDFs */
export const UrlSchema = z
  .string()
  .url('Must be a valid URL')
  .describe('URL pointing to a PDF file (HTTP or HTTPS)');
