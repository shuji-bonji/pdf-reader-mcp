/**
 * Unified error handling for pdf-reader-mcp
 */

import { isAbsolute, normalize } from 'node:path';

export class PdfReaderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'PdfReaderError';
  }
}

/**
 * Handle errors and return user-friendly messages with actionable suggestions.
 */
export function handleError(error: unknown): string {
  if (error instanceof PdfReaderError) {
    let msg = `Error: ${error.message}`;
    if (error.suggestion) {
      msg += `\n\nSuggestion: ${error.suggestion}`;
    }
    return msg;
  }

  if (error instanceof Error) {
    const message = error.message;

    // File not found
    if (message.includes('ENOENT') || message.includes('no such file')) {
      return 'Error: File not found. Please check the file path is correct and the file exists.';
    }

    // Permission denied
    if (message.includes('EACCES') || message.includes('permission denied')) {
      return 'Error: Permission denied. Please check file permissions.';
    }

    // Invalid PDF
    if (message.includes('Invalid PDF') || message.includes('PDF header not found')) {
      return 'Error: The file does not appear to be a valid PDF. Please check the file is not corrupted.';
    }

    // Encrypted PDF
    if (message.includes('password') || message.includes('encrypted')) {
      return 'Error: This PDF is password-protected. Encrypted PDFs are not currently supported.';
    }

    // File too large
    if (message.includes('too large') || message.includes('MAX_FILE_SIZE')) {
      return 'Error: File exceeds the 50MB size limit. Try splitting the PDF into smaller parts.';
    }

    return `Error: ${message}`;
  }

  return `Error: An unexpected error occurred: ${String(error)}`;
}

/**
 * Validate that a file path points to a PDF.
 *
 * Security checks:
 * - Path must be non-empty
 * - Path must be absolute (prevents relative path traversal)
 * - Path must not contain `..` segments after normalization
 * - Path must have a `.pdf` extension
 */
export function validatePdfPath(filePath: string): void {
  if (!filePath) {
    throw new PdfReaderError(
      'File path is required.',
      'MISSING_PATH',
      'Provide a valid file path to a PDF document.',
    );
  }

  if (!isAbsolute(filePath)) {
    throw new PdfReaderError(
      'File path must be absolute.',
      'RELATIVE_PATH',
      'Provide an absolute file path (e.g., /home/user/document.pdf).',
    );
  }

  const normalized = normalize(filePath);
  if (normalized.includes('..')) {
    throw new PdfReaderError(
      'Path traversal is not allowed.',
      'PATH_TRAVERSAL',
      'Provide a direct absolute path without ".." segments.',
    );
  }

  if (!normalized.toLowerCase().endsWith('.pdf')) {
    throw new PdfReaderError(
      `Expected a .pdf file, got: ${filePath}`,
      'INVALID_EXTENSION',
      'Ensure the file has a .pdf extension.',
    );
  }
}
