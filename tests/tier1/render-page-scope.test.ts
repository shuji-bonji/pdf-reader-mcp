/**
 * render_page の射程の節（openspec/specs/render-page の 002）のうち、予算を越えた状態。
 * ツールの引数では予算を変えられないので、描画の結果を差し替えて確かめる。
 * 全ページを描画できた状態は tests/e2e/23-page-count-and-render-scope.test.ts が測る。
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/page-renderer.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/services/page-renderer.js')>();
  return {
    ...original,
    rendererAvailable: async () => true,
    renderPages: async () => ({
      requested: [1, 2, 3],
      pages: [
        {
          page: 1,
          pointWidth: 200,
          pointHeight: 200,
          width: 417,
          height: 417,
          effectiveDpi: 150,
          mimeType: 'image/png',
          encodedBytes: 10,
          dataBase64: 'AA==',
        },
      ],
      omitted: [
        { page: 2, reason: 'the response budget of 10 bytes was reached' },
        { page: 3, reason: 'the response budget of 10 bytes was reached' },
      ],
      totalEncodedBytes: 10,
    }),
  };
});

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Handler = (params: unknown) => Promise<ToolResult>;

describe('render_page scope when the budget is reached', () => {
  it('SPEC-READER-RENDER-PAGE-002 描画しなかったページを射程の節に書く', async () => {
    const { registerRenderPage } = await import('../../src/tools/tier1/render-page.js');
    let handler: Handler | null = null;
    registerRenderPage({
      registerTool: (_name: string, _def: unknown, fn: Handler) => {
        handler = fn;
      },
    } as never);
    if (!handler) throw new Error('render_page did not register');
    const result = await (handler as Handler)({ file_path: '/tmp/any.pdf', pages: '1-3' });
    const text = result.content.find((c) => c.type === 'text')?.text ?? '';
    const scope = text.split('\n\n')[1] ?? '';
    expect(text.startsWith('## Scope of this reading')).toBe(true);
    expect(scope).toContain('- Pages requested: 1–3');
    expect(scope).toContain('- Pages rendered: 1');
    expect(scope).toContain('- Page 2: NOT DONE — the response budget of 10 bytes was reached');
    expect(scope).toContain('- Page 3: NOT DONE');
  });
});
