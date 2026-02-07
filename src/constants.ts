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
export const SERVER_VERSION = '0.1.0';

/** Response format enum */
export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}
