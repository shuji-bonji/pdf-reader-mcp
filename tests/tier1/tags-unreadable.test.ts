/**
 * extract_structured_text: 構造木だけが読めなかったとき（openspec/specs/extract-structured-text の 001）
 *
 * 鍵を導けない文書では文字の観測（§9.10.1）も失敗するので、実ファイルでは
 * 「構造木だけが読めない」状況を作れない。観測の関数を成功に差し替えて確かめる。
 * 両方が失敗する実ファイルの場合は tests/e2e/20-tags-unreadable.test.ts が測る。
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LOCKED_TAGGED_TABLE } from '../e2e/locked-specimens.js';

vi.mock('../../src/services/text-extractability-service.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/services/text-extractability-service.js')>();
  return { ...original, observeExtractability: async () => [] };
});

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Handler = (params: unknown) => Promise<ToolResult>;

describe('extract_structured_text when only the structure tree could not be read', () => {
  it('SPEC-READER-EXTRACT-STRUCTURED-TEXT-001 構造木だけが読めなかったときは isTagged が null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tags-unreadable-'));
    const locked = join(dir, LOCKED_TAGGED_TABLE.name);
    writeFileSync(locked, Buffer.from(LOCKED_TAGGED_TABLE.base64, 'base64'));

    const { registerExtractStructuredText } = await import(
      '../../src/tools/tier2/extract-structured-text.js'
    );
    let handler: Handler | null = null;
    registerExtractStructuredText({
      registerTool: (_name: string, _def: unknown, fn: Handler) => {
        handler = fn;
      },
    } as never);
    if (!handler) throw new Error('extract_structured_text did not register');

    const result = await (handler as Handler)({ file_path: locked, response_format: 'json' });
    expect(result.isError).not.toBe(true);
    const body = JSON.parse(result.content.find((c) => c.type === 'text')?.text ?? '');
    expect(body.scope.textExtraction.status).toBe('failed');
    expect(body.scope.textExtraction.code).toBe('ENCRYPTED_PDF');
    expect(body.isTagged).toBeNull();
    expect(body.elements).toBeNull();
  });
});
