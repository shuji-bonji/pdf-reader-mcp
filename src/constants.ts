/**
 * pdf-reader-mcp shared constants
 */

/** Maximum response size in characters */
export const CHARACTER_LIMIT = 25_000;

/** Maximum PDF file size in bytes (50MB) */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Default page limit for text extraction */
export const DEFAULT_PAGE_LIMIT = 50;

/** Maximum number of search results to return */
export const MAX_SEARCH_RESULTS = 100;

/** Default context characters around search matches */
export const DEFAULT_SEARCH_CONTEXT = 80;

/** Server info */
export const SERVER_NAME = 'pdf-reader-mcp';
export const SERVER_VERSION = '0.6.1';

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
