/**
 * pdf-reader-mcp shared constants
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string };

/** Maximum response size in characters */
export const CHARACTER_LIMIT = 25_000;

/** Maximum PDF file size in bytes (50MB) */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Default page limit for text extraction */
export const DEFAULT_PAGE_LIMIT = 50;

/**
 * Ceiling on the ENCODED image bytes one `read_images` response may carry (#22).
 *
 * A 200 dpi A4 scan decodes to 1654×2339×3 = 11.6 MB of pixels, which is ~15.5 MB
 * once base64'd — a single image can therefore exceed anything a client will
 * accept. `read_text` has had a character limit since the beginning; images had
 * none, which is the asymmetry this closes. Images beyond the budget are named
 * and omitted rather than silently dropped.
 */
export const MAX_IMAGE_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Ceiling on the pixels of a single image this server will re-encode.
 *
 * The encoders are plain JavaScript. Above this size the cost is measured in
 * seconds, and a caller who wants such an image should say what size they want
 * it at (`max_width` / `max_height`) rather than wait for the full one.
 */
export const MAX_IMAGE_PIXELS = 40_000_000;

/** Default JPEG quality for `read_images` when `format: "jpeg"` is asked for. */
export const DEFAULT_IMAGE_QUALITY = 80;

/** Maximum number of search results to return */
export const MAX_SEARCH_RESULTS = 100;

/** Default context characters around search matches */
export const DEFAULT_SEARCH_CONTEXT = 80;

/** Server info */
export const SERVER_NAME = 'pdf-reader-mcp';

/** Sourced from package.json so it cannot drift out of sync on release. */
export const SERVER_VERSION = packageJson.version;

/**
 * Default concurrency cap for remote PDF fetches (`read_url`).
 * Can be overridden with the `PDF_READER_CONCURRENCY` environment variable.
 *
 * 同一プロセス内で複数の `read_url` 呼び出しが並列に走った場合、
 * 同時 fetch 数をこの値に制限することでリモートホストへの過剰負荷と
 * レート制限の発火を防ぐ。
 */
export const DEFAULT_FETCH_CONCURRENCY = 4;

/** 環境変数で上書きされた fetch 同時実行数（無効値ならデフォルト） */
export const FETCH_CONCURRENCY =
  Number.parseInt(process.env.PDF_READER_CONCURRENCY ?? '', 10) || DEFAULT_FETCH_CONCURRENCY;

/** Response format enum */
export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}
