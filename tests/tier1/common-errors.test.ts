/**
 * エラー応答の契約のうち、実ファイルでは作れない状況（openspec/specs/common-errors）
 *
 * - 分類できない例外（サーバーの故障）
 * - 描画の部品が読み込めない状態の render_page
 * - サーバーが返しうるすべての code の retryable
 *
 * 実ファイルで作れる状況は tests/e2e/18-common-errors.test.ts が測る。
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/page-renderer.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/services/page-renderer.js')>();
  return { ...original, rendererAvailable: async () => false };
});

import { type LawErrorCode, makeError } from '../../src/errors.js';
import { handleStructuredError } from '../../src/utils/error-handler.js';

const TOP_LEVEL = new Set(['error', 'code', 'retryable', 'hint', 'next_actions', 'detail']);

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Handler = (params: unknown) => Promise<ToolResult>;

async function renderPageWithoutRenderer() {
  const { registerRenderPage } = await import('../../src/tools/tier1/render-page.js');
  let handler: Handler | null = null;
  registerRenderPage({
    registerTool: (_name: string, _def: unknown, fn: Handler) => {
      handler = fn;
    },
  } as never);
  if (!handler) throw new Error('render_page did not register');
  const result = await (handler as Handler)({ file_path: '/tmp/any.pdf', pages: '1' });
  const text = result.content.find((c) => c.type === 'text')?.text ?? '';
  let body: Record<string, unknown> | undefined;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { isError: result.isError === true, text, body };
}

/** サーバーが返しうる code（SPEC-READER-COMMON-ERRORS-002・004） */
const ALL_CODES: Record<LawErrorCode, boolean> = {
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

describe('common-errors（実ファイルでは作れない状況）', () => {
  it('SPEC-READER-COMMON-ERRORS-001 故障のエラーも形どおり', () => {
    const err = handleStructuredError(new Error('something inside the server broke'));
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.error).toBe('something inside the server broke');
    expect(err.retryable).toBe(false);
    for (const k of Object.keys(err)) expect(TOP_LEVEL.has(k), k).toBe(true);
  });

  it('SPEC-READER-COMMON-ERRORS-001 描画の部品が無いときも JSON で返す', async () => {
    const res = await renderPageWithoutRenderer();
    expect(res.isError).toBe(true);
    expect(res.body, res.text).toBeTypeOf('object');
    for (const k of Object.keys(res.body ?? {})) expect(TOP_LEVEL.has(k), k).toBe(true);
  });

  it('SPEC-READER-COMMON-ERRORS-002 描画の部品が無いときは RENDERER_NOT_AVAILABLE', async () => {
    const res = await renderPageWithoutRenderer();
    expect(res.body?.code).toBe('RENDERER_NOT_AVAILABLE');
    expect(res.body?.error).toContain('@hyzyla/pdfium');
    expect(res.body?.error).toContain('npm install');
  });

  it('SPEC-READER-COMMON-ERRORS-004 描画の部品が無いときは再試行できる', async () => {
    const res = await renderPageWithoutRenderer();
    expect(res.body?.retryable).toBe(true);
  });

  it('SPEC-READER-COMMON-ERRORS-004 すべての code に値が決まっている', () => {
    const got = Object.fromEntries(
      Object.keys(ALL_CODES).map((code) => [code, makeError(code as LawErrorCode, 'x').retryable]),
    );
    expect(got).toEqual(ALL_CODES);
  });
});

describe('SPEC-READER-COMMON-ERRORS-008 入力を読めないファイルシステムのエラーは INVALID_ARGUMENT にする', () => {
  const errno = (code: string, path: string) =>
    Object.assign(new Error(`${code}: something happened, open '${path}'`), { code, path });

  it('SPEC-READER-COMMON-ERRORS-008 EACCES の例外の分類', () => {
    const original = errno('EACCES', '/tmp/locked.pdf');
    const err = handleStructuredError(original);
    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(err.retryable).toBe(true);
    expect(err.detail?.reason).toBe('PERMISSION_DENIED');
    expect(err.detail?.path).toBe('/tmp/locked.pdf');
    expect(err.detail?.cause).toBe(original.message);
  });

  it('SPEC-READER-COMMON-ERRORS-008 存在しないパスは今までどおり DOC_NOT_FOUND', () => {
    expect(handleStructuredError(errno('ENOENT', '/tmp/none.pdf')).code).toBe('DOC_NOT_FOUND');
  });
});
