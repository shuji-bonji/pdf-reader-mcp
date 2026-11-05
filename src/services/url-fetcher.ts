/**
 * Remote PDF fetcher service.
 *
 * v0.6.1+ では module-level の shared limiter で同時 fetch 数を制限する。
 * 上限は `PDF_READER_CONCURRENCY` 環境変数で上書き可能（既定 4）。
 *
 * テスト用に制限なしで呼びたい場合は `fetchPdfFromUrlUnlimited()` を使う。
 */

import { FETCH_CONCURRENCY, MAX_FILE_SIZE, SERVER_NAME, SERVER_VERSION } from '../constants.js';
import { NEXT_ACTIONS } from '../errors.js';
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
export async function fetchPdfFromUrlUnlimited(
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<Uint8Array> {
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

  // 🔴 本文の受信（arrayBuffer）も同じ signal の下にあり、そこでも時間切れ・切断が起きる。
  // 両方を包む。
  try {
    return await fetchBody(url, options.timeoutMs ?? FETCH_TIMEOUT_MS);
  } catch (error) {
    throw classifyNetworkError(error) ?? error;
  }
}

/** `read_url` の時間切れ（ミリ秒）。 */
const FETCH_TIMEOUT_MS = 30_000;

async function fetchBody(url: string, timeoutMs: number): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/pdf',
      'User-Agent': `${SERVER_NAME}/${SERVER_VERSION}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
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

/** 時間切れを表す `cause.code`（undici と Node の net）。 */
const TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ETIMEDOUT',
]);

/** TLS の失敗を表す `cause.code` のうち、接頭辞で括れないもの。 */
const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

function isTlsCode(code: string): boolean {
  return (
    TLS_CODES.has(code) ||
    code.startsWith('CERT_') ||
    code.startsWith('ERR_TLS_') ||
    code.startsWith('ERR_SSL_')
  );
}

/**
 * `fetch` のネットワークの失敗を、**例外の名前と `cause.code`** で family の code に分ける
 * （#46・SPEC-READER-COMMON-ERRORS-007）。
 *
 * Node の `fetch` は、接続を拒まれても・名前を引けなくても・証明書を検証できなくても、
 * 文が `fetch failed` の `TypeError` を投げる。理由は `error.cause.code` にしか無い。
 * 時間切れは `AbortSignal.timeout` の `DOMException` で、名前が `TimeoutError`。
 * 0.19.0 は文で分けていたので、どれも INTERNAL_ERROR（この server の故障）になっていた。
 *
 * 分けられないものは `undefined` を返し、呼び出し側は元の例外を投げ直す。
 */
export function classifyNetworkError(error: unknown): PdfReaderError | undefined {
  if (error instanceof PdfReaderError || !(error instanceof Error)) return undefined;

  const cause = (error as { cause?: unknown }).cause;
  const causeCode =
    typeof cause === 'object' &&
    cause !== null &&
    typeof (cause as { code?: unknown }).code === 'string'
      ? (cause as { code: string }).code
      : undefined;
  const causeMessage =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined;
  const detail = {
    cause: `${error.message}${causeCode ? ` (${causeCode})` : ''}${causeMessage ? `: ${causeMessage}` : ''}`,
  };

  if (error.name === 'TimeoutError' || (causeCode && TIMEOUT_CODES.has(causeCode))) {
    return new PdfReaderError(
      'Request to remote PDF timed out.',
      'FETCH_TIMEOUT',
      'The network is slow, or the remote server did not respond in time.',
      'SOURCE_TIMEOUT',
      [NEXT_ACTIONS.retryLater()],
      detail,
    );
  }

  // それ以外の TypeError（引数の誤りなど）は、ネットワークの失敗ではないので分けない。
  if (error.name !== 'TypeError' || error.message !== 'fetch failed') return undefined;

  if (causeCode && isTlsCode(causeCode)) {
    return new PdfReaderError(
      'The TLS connection to the remote host failed.',
      'FETCH_TLS',
      "The server's certificate could not be verified, or the TLS handshake failed " +
        '(an expired certificate, a name that does not match, a missing intermediate ' +
        'certificate, an untrusted or self-signed CA, or no TLS version or cipher in common). ' +
        'This is usually the configuration of the remote server, but a wrong clock on this ' +
        'machine also causes it. Trying the same URL again will not change the result.',
      'SOURCE_API_ERROR',
      [NEXT_ACTIONS.checkUrl()],
      detail,
    );
  }

  // Fetch Standard の「bad port」（port blocking）。fetch が接続を試みずに断る。URL を直すしかない。
  if (causeMessage === 'bad port') {
    return new PdfReaderError(
      `The URL uses a port that fetch refuses to connect to: ${error.message}.`,
      'BAD_PORT',
      'The Fetch Standard blocks this port ("bad port"). Use a URL with a different port.',
      'INVALID_ARGUMENT',
      [NEXT_ACTIONS.checkUrl()],
      detail,
    );
  }

  return new PdfReaderError(
    'Failed to reach the remote host.',
    'FETCH_UNREACHABLE',
    'The host refused the connection, closed it, or its name could not be resolved.',
    'SOURCE_UNAVAILABLE',
    [NEXT_ACTIONS.checkUrl(), NEXT_ACTIONS.retryLater()],
    detail,
  );
}
