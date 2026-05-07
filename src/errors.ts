/**
 * houki-hub family-compatible 構造化エラー応答 — pdf-reader-mcp 独自実装
 *
 * 設計指針:
 * - houki-hub family の error contract に準拠 (`code` 文字列を共有)
 * - 共通パッケージ依存を持たず独立実装 (pdf-reader-mcp は汎用 PDF ツールであり、
 *   houki-abbreviations 等の家族専用パッケージへ依存させない)
 * - houki-egov-mcp / houki-nta-mcp の `src/errors.ts` をリファレンスとし、
 *   PDF 固有のコード (INVALID_PDF / ENCRYPTED_PDF 等) を追加
 *
 * family contract 仕様:
 * @see https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-CODES.md
 * @see https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-HANDLING.md
 */

/**
 * family 共通エラーコード — pdf-reader-mcp で使用する部分集合 + PDF 固有拡張。
 *
 * - 引数・入力 (クライアント側責任): `INVALID_ARGUMENT`
 * - リソース未発見: `DOC_NOT_FOUND`
 * - PDF コンテンツ: `INVALID_PDF` / `ENCRYPTED_PDF` / `UNSUPPORTED_PDF_FEATURE`
 * - 外部ソース由来: `SOURCE_API_ERROR` / `SOURCE_TIMEOUT` / `SOURCE_UNAVAILABLE`
 * - PDF 固有: `FILE_TOO_LARGE` (50MB 制限超過)
 * - システム: `INTERNAL_ERROR`
 */
export type LawErrorCode =
  // 引数・入力 (クライアント責任)
  | 'INVALID_ARGUMENT'
  // リソース未発見
  | 'DOC_NOT_FOUND'
  // PDF コンテンツ
  | 'INVALID_PDF'
  | 'ENCRYPTED_PDF'
  | 'UNSUPPORTED_PDF_FEATURE'
  // 外部ソース由来 (url-fetcher)
  | 'SOURCE_API_ERROR'
  | 'SOURCE_TIMEOUT'
  | 'SOURCE_UNAVAILABLE'
  // pdf-reader-mcp 固有
  | 'FILE_TOO_LARGE'
  // システム
  | 'INTERNAL_ERROR';

/**
 * 次に取るべきアクションの提案。
 * LLM がこれを読んで自律的に次のツールを呼ぶことを想定。
 */
export interface NextAction {
  /** 推奨アクション (tool 名 or 自然言語) */
  action: string;
  /** どんなときに有効か */
  reason: string;
  /** 具体的な引数例 (任意) */
  example?: Record<string, unknown>;
}

/**
 * family-compatible 共通エラー応答。
 */
export interface LawServiceError {
  /** 1文の人間可読メッセージ (LLM もここを読む) */
  error: string;
  /** プログラム判定用の安定したコード */
  code: LawErrorCode;
  /** 追加情報 (任意) */
  hint?: string;
  /** LLM が次に呼ぶべき tool / 取るべき手段の候補 */
  next_actions?: NextAction[];
  /** 一時的エラーかどうか (true なら時間をおいて再試行可) */
  retryable?: boolean;
  /** 元のエラー詳細 (debug 用) */
  detail?: {
    status?: number;
    url?: string;
    cause?: string;
  };
}

/**
 * エラーレスポンスを構築するヘルパー。
 * 必須フィールド (error, code) と任意フィールドを安全に組み立てる。
 */
export function makeError(
  code: LawErrorCode,
  message: string,
  options: {
    hint?: string;
    next_actions?: NextAction[];
    retryable?: boolean;
    detail?: LawServiceError['detail'];
  } = {},
): LawServiceError {
  const err: LawServiceError = { error: message, code };
  if (options.hint) err.hint = options.hint;
  if (options.next_actions && options.next_actions.length > 0) {
    err.next_actions = options.next_actions;
  }
  if (options.retryable !== undefined) err.retryable = options.retryable;
  if (options.detail) err.detail = options.detail;
  return err;
}

/** オブジェクトが LawServiceError かどうかの type guard */
export function isLawServiceError(value: unknown): value is LawServiceError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    'code' in value &&
    typeof (value as { error: unknown }).error === 'string' &&
    typeof (value as { code: unknown }).code === 'string'
  );
}

/**
 * よく使う next_actions のプリセット。
 * pdf-reader-mcp 固有の tool 名を含む。
 */
export const NEXT_ACTIONS = {
  checkFilePath: (filePath?: string): NextAction => ({
    action: 'verify_file_path',
    reason: 'ファイルパスが正しいか、絶対パスで指定されているか確認してください',
    example: filePath ? { file_path: filePath } : undefined,
  }),
  useGetPageCount: (filePath?: string): NextAction => ({
    action: 'get_page_count',
    reason: '総ページ数を確認してから pages を指定してください',
    example: filePath ? { file_path: filePath } : undefined,
  }),
  useInspectStructure: (filePath?: string): NextAction => ({
    action: 'inspect_structure',
    reason: 'PDF が壊れている可能性があります。Catalog / Pages 等の構造を確認してください',
    example: filePath ? { file_path: filePath } : undefined,
  }),
  splitPdf: (): NextAction => ({
    action: 'split_pdf',
    reason: 'ファイルサイズが 50MB を超えています。分割してから再試行してください',
  }),
  retryLater: (): NextAction => ({
    action: 'retry_later',
    reason: '一時的なネットワークエラーの可能性があります。30秒〜数分後に再試行してください',
  }),
  checkUrl: (url?: string): NextAction => ({
    action: 'verify_url',
    reason: 'URL が正しいか・HTTP/HTTPS であるか確認してください',
    example: url ? { url } : undefined,
  }),
} as const;
