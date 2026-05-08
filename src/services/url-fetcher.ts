/**
 * Remote PDF fetcher service.
 *
 * v0.6.1+ では module-level の shared limiter で同時 fetch 数を制限する。
 * 上限は `PDF_READER_CONCURRENCY` 環境変数で上書き可能（既定 4）。
 *
 * テスト用に制限なしで呼びたい場合は `fetchPdfFromUrlUnlimited()` を使う。
 */

import { FETCH_CONCURRENCY, MAX_FILE_SIZE, SERVER_NAME, SERVER_VERSION } from '../constants.js';
import { createLimit } from '../utils/concurrency.js';
import { PdfReaderError } from '../utils/error-handler.js';

/** module-level shared limiter — 全 read_url 呼び出しが同じ limiter を経由する */
const fetchLimit = createLimit(FETCH_CONCURRENCY);

/**
 * Fetch a PDF from a URL and return it as Uint8Array.
 *
 * 同時実行数は `FETCH_CONCURRENCY` で制限される。LLM が複数 `read_url` を
 * 並列に呼んでも、リモートホストへの過剰負荷とレート制限を防ぐ。
 */
export async function fetchPdfFromUrl(url: string): Promise<Uint8Array> {
  return fetchLimit(() => fetchPdfFromUrlUnlimited(url));
}

/**
 * Limit を経由しない素の fetch 実装。
 * テスト用、または limit 経由がすでに保証されている呼び出し側用。
 */
export async function fetchPdfFromUrlUnlimited(url: string): Promise<Uint8Array> {
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
      'User-Agent': `${SERVER_NAME}/${SERVER_VERSION}`,
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
