/**
 * PDF-specific utility functions.
 */

import { readFile, stat } from 'node:fs/promises';
import { MAX_FILE_SIZE } from '../constants.js';
import { PdfReaderError, validatePdfPath } from './error-handler.js';

/**
 * Read a PDF file into a Uint8Array with size validation.
 */
export async function readPdfFile(filePath: string): Promise<Uint8Array> {
  validatePdfPath(filePath);

  const fileStats = await stat(filePath);
  if (fileStats.size > MAX_FILE_SIZE) {
    throw new PdfReaderError(
      `File size (${(fileStats.size / 1024 / 1024).toFixed(1)}MB) exceeds the 50MB limit.`,
      'FILE_TOO_LARGE',
      'Split the PDF into smaller parts before processing.',
    );
  }

  const buffer = await readFile(filePath);
  return new Uint8Array(buffer);
}

/**
 * Get file size without reading the whole file.
 */
export async function getFileSize(filePath: string): Promise<number> {
  const fileStats = await stat(filePath);
  return fileStats.size;
}

/**
 * Parse a page range string like "1-5" or "3" into an array of 1-based page numbers.
 * Returns null if no range specified (meaning "all pages").
 */
export function parsePageRange(pages: string | undefined, totalPages: number): number[] | null {
  if (!pages) return null;

  const result: number[] = [];
  const parts = pages.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = Math.max(1, parseInt(startStr, 10));
      const end = Math.min(totalPages, parseInt(endStr, 10));
      if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new PdfReaderError(
          `Invalid page range: "${trimmed}"`,
          'INVALID_PAGE_RANGE',
          'Use format like "1-5", "3", or "1,3,5-7".',
        );
      }
      for (let i = start; i <= end; i++) {
        result.push(i);
      }
    } else {
      const pageNum = parseInt(trimmed, 10);
      if (Number.isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
        throw new PdfReaderError(
          `Invalid page number: ${trimmed} (document has ${totalPages} pages)`,
          'INVALID_PAGE_NUMBER',
          `Specify a page between 1 and ${totalPages}.`,
        );
      }
      result.push(pageNum);
    }
  }

  return [...new Set(result)].sort((a, b) => a - b);
}
