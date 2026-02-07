/**
 * Remote PDF fetcher service.
 */

import { MAX_FILE_SIZE } from '../constants.js';
import { PdfReaderError } from '../utils/error-handler.js';

/**
 * Fetch a PDF from a URL and return it as Uint8Array.
 */
export async function fetchPdfFromUrl(url: string): Promise<Uint8Array> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new PdfReaderError(
      `Invalid URL: ${url}`,
      'INVALID_URL',
      'Provide a valid HTTP or HTTPS URL pointing to a PDF file.',
    );
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new PdfReaderError(
      `Unsupported protocol: ${parsedUrl.protocol}`,
      'UNSUPPORTED_PROTOCOL',
      'Only HTTP and HTTPS URLs are supported.',
    );
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/pdf',
      'User-Agent': 'pdf-reader-mcp/0.1.0',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new PdfReaderError(
      `Failed to fetch PDF: HTTP ${response.status} ${response.statusText}`,
      'FETCH_FAILED',
      'Check the URL is correct and accessible.',
    );
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
    throw new PdfReaderError(
      `Remote PDF size (${(parseInt(contentLength, 10) / 1024 / 1024).toFixed(1)}MB) exceeds the 50MB limit.`,
      'FILE_TOO_LARGE',
      'Try a smaller PDF file.',
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_FILE_SIZE) {
    throw new PdfReaderError(
      `Downloaded PDF size (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB) exceeds the 50MB limit.`,
      'FILE_TOO_LARGE',
      'Try a smaller PDF file.',
    );
  }

  return new Uint8Array(buffer);
}
