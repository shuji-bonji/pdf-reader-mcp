/**
 * Unified error handling for pdf-reader-mcp.
 *
 * v0.6.0+ では houki-hub family-compatible な構造化エラー (`LawServiceError`)
 * を返す `handleStructuredError()` を提供する。
 * 既存の `handleError()` は内部で同関数を呼び、後方互換のため文字列を返す。
 *
 * @see ../errors.ts (family contract のローカル実装)
 */

import { isAbsolute, normalize } from 'node:path';
import {
  type LawErrorCode,
  type LawServiceError,
  makeError,
  NEXT_ACTIONS,
  type NextAction,
} from '../errors.js';

/**
 * pdf-reader-mcp 固有の例外クラス。
 *
 * v0.6.0 以降は `familyCode` (LawErrorCode) を直接指定して投げることで、
 * `handleStructuredError()` が family code をそのまま採用する。
 * `familyCode` 未指定時は `code` (legacy 文字列) と message から推定される。
 */
export class PdfReaderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly suggestion?: string,
    public readonly familyCode?: LawErrorCode,
    public readonly nextActions?: NextAction[],
    public readonly retryable?: boolean,
    public readonly detail?: LawServiceError['detail'],
  ) {
    super(message);
    this.name = 'PdfReaderError';
  }
}

/**
 * legacy `PdfReaderError.code` (string) を family `LawErrorCode` にマッピングする。
 * 未マッピングのものは `INTERNAL_ERROR` に倒す。
 */
function mapLegacyCodeToFamily(legacyCode: string): LawErrorCode {
  switch (legacyCode) {
    case 'MISSING_PATH':
    case 'RELATIVE_PATH':
    case 'PATH_TRAVERSAL':
    case 'INVALID_EXTENSION':
    case 'INVALID_URL':
    case 'UNSUPPORTED_PROTOCOL':
    case 'INVALID_PAGE_RANGE':
    case 'INVALID_PAGE_NUMBER':
      return 'INVALID_ARGUMENT';
    case 'FILE_TOO_LARGE':
      return 'FILE_TOO_LARGE';
    case 'FETCH_FAILED':
      return 'SOURCE_API_ERROR';
    default:
      return 'INTERNAL_ERROR';
  }
}

/**
 * `Error` インスタンスのメッセージを家族 LawErrorCode に推定マッピングする。
 * 既存 `handleError()` の文字列分岐ロジックと同等の判定を行う。
 */
function inferFamilyCodeFromMessage(message: string): LawErrorCode | undefined {
  if (message.includes('ENOENT') || message.includes('no such file')) {
    return 'DOC_NOT_FOUND';
  }
  if (message.includes('EACCES') || message.includes('permission denied')) {
    return 'INTERNAL_ERROR';
  }
  if (message.includes('Invalid PDF') || message.includes('PDF header not found')) {
    return 'INVALID_PDF';
  }
  if (message.includes('password') || message.includes('encrypted')) {
    return 'ENCRYPTED_PDF';
  }
  if (message.includes('too large') || message.includes('MAX_FILE_SIZE')) {
    return 'FILE_TOO_LARGE';
  }
  // node-fetch / undici が投げる代表的なネットワークエラー
  if (
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('EAI_AGAIN') ||
    message.includes('getaddrinfo')
  ) {
    return 'SOURCE_UNAVAILABLE';
  }
  if (
    message.includes('TimeoutError') ||
    message.includes('AbortError') ||
    message.includes('signal is aborted') ||
    message.includes('timed out')
  ) {
    return 'SOURCE_TIMEOUT';
  }
  return undefined;
}

/**
 * legacy code から next_actions のデフォルトを生成する。
 */
function defaultNextActionsForLegacy(legacyCode: string): NextAction[] | undefined {
  switch (legacyCode) {
    case 'MISSING_PATH':
    case 'RELATIVE_PATH':
    case 'PATH_TRAVERSAL':
    case 'INVALID_EXTENSION':
      return [NEXT_ACTIONS.checkFilePath()];
    case 'INVALID_URL':
    case 'UNSUPPORTED_PROTOCOL':
      return [NEXT_ACTIONS.checkUrl()];
    case 'INVALID_PAGE_RANGE':
    case 'INVALID_PAGE_NUMBER':
      return [NEXT_ACTIONS.useGetPageCount()];
    case 'FILE_TOO_LARGE':
      return [NEXT_ACTIONS.splitPdf()];
    case 'FETCH_FAILED':
      return [NEXT_ACTIONS.retryLater()];
    default:
      return undefined;
  }
}

/**
 * unknown を構造化エラー (`LawServiceError`) に正規化する。
 *
 * - `PdfReaderError` の場合は `familyCode` 優先で family code を採用
 * - 通常の `Error` はメッセージから推定マッピング
 * - それ以外は `INTERNAL_ERROR`
 */
export function handleStructuredError(error: unknown): LawServiceError {
  // PdfReaderError: 既知の構造を最大限活用する
  if (error instanceof PdfReaderError) {
    const code = error.familyCode ?? mapLegacyCodeToFamily(error.code);
    const next_actions = error.nextActions ?? defaultNextActionsForLegacy(error.code);
    return makeError(code, error.message, {
      hint: error.suggestion,
      next_actions,
      retryable: error.retryable,
      detail: error.detail ?? { cause: `PdfReaderError(${error.code})` },
    });
  }

  // 通常の Error: メッセージから推定
  if (error instanceof Error) {
    const inferred = inferFamilyCodeFromMessage(error.message);
    if (inferred) {
      // 推定できた場合: 適切なヒント / next_actions を付与
      return buildInferredError(inferred, error.message, error);
    }
    // 推定できなかった場合は INTERNAL_ERROR
    return makeError('INTERNAL_ERROR', error.message, {
      detail: { cause: error.name },
    });
  }

  // Error 派生でもない: 文字列化して INTERNAL_ERROR
  return makeError('INTERNAL_ERROR', `An unexpected error occurred: ${String(error)}`);
}

/**
 * 推定 family code に応じたヒント / next_actions を組み立てる。
 */
function buildInferredError(
  code: LawErrorCode,
  rawMessage: string,
  original: Error,
): LawServiceError {
  switch (code) {
    case 'DOC_NOT_FOUND':
      return makeError(code, 'File not found.', {
        hint: 'ファイルパスが正しいか、ファイルが存在するか確認してください。',
        next_actions: [NEXT_ACTIONS.checkFilePath()],
        detail: { cause: original.message },
      });
    case 'INTERNAL_ERROR':
      // EACCES の場合はヒントを差し替える
      if (rawMessage.includes('EACCES') || rawMessage.includes('permission denied')) {
        return makeError(code, 'Permission denied.', {
          hint: 'ファイルパーミッションを確認してください。',
          detail: { cause: original.message },
        });
      }
      return makeError(code, rawMessage, { detail: { cause: original.name } });
    case 'INVALID_PDF':
      return makeError(code, 'The file does not appear to be a valid PDF.', {
        hint: 'ファイルが破損していないか確認してください。',
        next_actions: [NEXT_ACTIONS.useInspectStructure()],
        detail: { cause: original.message },
      });
    case 'ENCRYPTED_PDF':
      return makeError(code, 'This PDF is password-protected.', {
        hint: '現在 pdf-reader-mcp は暗号化 PDF をサポートしていません。',
        detail: { cause: original.message },
      });
    case 'FILE_TOO_LARGE':
      return makeError(code, 'File exceeds the 50MB size limit.', {
        hint: 'PDF を分割してから再試行してください。',
        next_actions: [NEXT_ACTIONS.splitPdf()],
        detail: { cause: original.message },
      });
    case 'SOURCE_UNAVAILABLE':
      return makeError(code, 'Failed to reach the remote host.', {
        hint: 'URL のホストが応答していない、または DNS が解決できません。',
        next_actions: [NEXT_ACTIONS.checkUrl(), NEXT_ACTIONS.retryLater()],
        retryable: true,
        detail: { cause: original.message },
      });
    case 'SOURCE_TIMEOUT':
      return makeError(code, 'Request to remote PDF timed out.', {
        hint: 'ネットワークが遅いか、サーバーが応答しません。',
        next_actions: [NEXT_ACTIONS.retryLater()],
        retryable: true,
        detail: { cause: original.message },
      });
    default:
      return makeError(code, rawMessage, { detail: { cause: original.message } });
  }
}

/**
 * `LawServiceError` を旧 `handleError()` 互換の人間可読文字列に整形する。
 *
 * 既存呼び出し側 (`handleError()`) のため後方互換に提供。
 */
export function formatStructuredErrorForHumans(err: LawServiceError): string {
  let msg = `Error: ${err.error}`;
  if (err.hint) {
    msg += `\n\nSuggestion: ${err.hint}`;
  }
  return msg;
}

/**
 * @deprecated v0.6.0 で構造化エラーが導入されました。
 * 新規 tool では `handleStructuredError()` を直接使用し、
 * `JSON.stringify(err, null, 2)` を `content.text` に入れる形で利用してください。
 *
 * 後方互換のため、本関数は引き続き人間可読な文字列を返します。
 * 内部では `handleStructuredError()` を呼んでから整形しています。
 */
export function handleError(error: unknown): string {
  return formatStructuredErrorForHumans(handleStructuredError(error));
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
