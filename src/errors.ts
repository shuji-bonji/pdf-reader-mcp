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
 * - reader 固有: `RENDERER_NOT_AVAILABLE`（render_page の描画の部品が読み込めない）
 * - システム: `INTERNAL_ERROR`
 *
 * 共通語彙と同じ意味の別名を作らない（pdf-agent-stack docs/specs/06 §2.3）。
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
  | 'RENDERER_NOT_AVAILABLE'
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
  /**
   * 引数・フラグ・環境を変えれば、同じ文書についての同じ読み取りが成功しうるか。
   * 値は `code` ごとに 1 つ（`RETRYABLE`）。SPEC-READER-COMMON-ERRORS-004
   */
  retryable: boolean;
  /** 元のエラー詳細 (debug 用) */
  detail?: {
    status?: number;
    url?: string;
    cause?: string;
  };
}

/**
 * `retryable` の値。**code ごとに 1 つ**で、エラーを作る箇所では選ばせない
 * （同じ code に 2 つの値があると、受け側は code で分岐できない）。
 *
 * 決め方は verify 0.33.0 と同じ「同じ文書についての同じ読み取りが成功しうるか」。
 * - `DOC_NOT_FOUND` は false（verify と §2.3 の例に合わせた。2026-11-05 決定）
 * - `ENCRYPTED_PDF` は false（reader には password 引数が無い。verify は true）
 * - `SOURCE_API_ERROR` は false（HTTP の失敗の多くは URL の誤り。2026-11-05 決定）
 *
 * `Record` なので、code を足して値を書き忘れると型検査で落ちる。
 * SPEC-READER-COMMON-ERRORS-004
 */
export const RETRYABLE: Readonly<Record<LawErrorCode, boolean>> = {
  INVALID_ARGUMENT: true,
  SOURCE_TIMEOUT: true,
  SOURCE_UNAVAILABLE: true,
  RENDERER_NOT_AVAILABLE: true,
  DOC_NOT_FOUND: false,
  INVALID_PDF: false,
  ENCRYPTED_PDF: false,
  UNSUPPORTED_PDF_FEATURE: false,
  FILE_TOO_LARGE: false,
  SOURCE_API_ERROR: false,
  INTERNAL_ERROR: false,
};

/**
 * エラーレスポンスを構築するヘルパー。
 * 必須フィールド (error, code, retryable) と任意フィールドを安全に組み立てる。
 * `retryable` は `RETRYABLE` から引く。
 */
export function makeError(
  code: LawErrorCode,
  message: string,
  options: {
    hint?: string;
    next_actions?: NextAction[];
    detail?: LawServiceError['detail'];
  } = {},
): LawServiceError {
  const err: LawServiceError = { error: message, code, retryable: RETRYABLE[code] };
  if (options.hint) err.hint = options.hint;
  if (options.next_actions && options.next_actions.length > 0) {
    err.next_actions = options.next_actions;
  }
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
 *
 * 🔴 `action` と `example` は受け側の Skill が分岐と再試行に使う。値を変えない
 * （SPEC-READER-COMMON-ERRORS-005）。`reason` は英語で書く（§2.3・F-10）。
 */
export const NEXT_ACTIONS = {
  checkFilePath: (filePath?: string): NextAction => ({
    action: 'verify_file_path',
    reason: 'Check that the file path is correct and absolute, and that the file exists.',
    example: filePath ? { file_path: filePath } : undefined,
  }),
  useGetPageCount: (filePath?: string): NextAction => ({
    action: 'get_page_count',
    reason: 'Check the total page count, then pass pages within it.',
    example: filePath ? { file_path: filePath } : undefined,
  }),
  useInspectStructure: (filePath?: string): NextAction => ({
    action: 'inspect_structure',
    reason:
      'Look at the catalog and the page tree to see where the file stops following the specification.',
    example: filePath ? { file_path: filePath } : undefined,
  }),
  splitPdf: (): NextAction => ({
    action: 'split_pdf',
    reason: 'The file is over the 50 MB limit. Split it, then call again with a part.',
  }),
  retryLater: (): NextAction => ({
    action: 'retry_later',
    reason: 'This may be a temporary network failure. Try again in 30 seconds to a few minutes.',
  }),
  checkUrl: (url?: string): NextAction => ({
    action: 'verify_url',
    reason: 'Check that the URL is correct, uses HTTP or HTTPS, and points to a PDF.',
    example: url ? { url } : undefined,
  }),
} as const;
