/**
 * 18 - エラー応答の契約（openspec/specs/common-errors）
 *
 * PDF family の規約（pdf-agent-stack docs/specs/06 §2.3）: ツール結果 `isError: true` の
 * 本文は平らな JSON で、`error`・`code`・`retryable` が必須、文の項目は英語、
 * 同じ状況には同じ `code` を返す。pdf-agent-stack の eval/e2e S6 と同じことを、
 * 18 ツールの実物（McpServer に登録したもの）を InMemoryTransport 越しに呼んで測る。
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { locateObjects } from '../../src/services/object-locator.js';
import { registerAllTools } from '../../src/tools/index.js';
import { HALVES_SPECIMENS } from './halves-specimens.js';
import { FIXTURES } from './setup.js';

const TOP_LEVEL = new Set(['error', 'code', 'retryable', 'hint', 'next_actions', 'detail']);
const JAPANESE = /[぀-ヿ㐀-鿿]/;

/** ファイルを 1 つ（compare_structure は 2 つ）受け取る 17 ツールと、呼ぶのに要る引数 */
const FILE_TOOLS: Record<string, (p: string) => Record<string, unknown>> = {
  get_page_count: (p) => ({ file_path: p }),
  get_metadata: (p) => ({ file_path: p }),
  read_text: (p) => ({ file_path: p }),
  search_text: (p) => ({ file_path: p, query: 'a' }),
  read_images: (p) => ({ file_path: p }),
  render_page: (p) => ({ file_path: p, pages: '1' }),
  summarize: (p) => ({ file_path: p }),
  inspect_structure: (p) => ({ file_path: p }),
  inspect_catalog: (p) => ({ file_path: p }),
  inspect_tags: (p) => ({ file_path: p }),
  inspect_fonts: (p) => ({ file_path: p }),
  inspect_annotations: (p) => ({ file_path: p }),
  inspect_signatures: (p) => ({ file_path: p }),
  extract_tables: (p) => ({ file_path: p }),
  extract_structured_text: (p) => ({ file_path: p }),
  locate_objects: (p) => ({ file_path: p, object_numbers: [1] }),
  compare_structure: (p) => ({ file_path_1: p, file_path_2: p }),
};

let client: Client;
let dir: string;
const files = { missing: '', empty: '', notPdf: '', truncated: '', encrypted: '' };
let http: Server;
let origin = '';

// biome-ignore lint/suspicious/noExplicitAny: 応答の形そのものを検査する
async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string; body: any }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  const text = result.content.find((c) => c.type === 'text')?.text ?? '';
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { isError: result.isError === true, text, body };
}

/** 本文が契約の形に反している点（空なら形どおり） */
// biome-ignore lint/suspicious/noExplicitAny: 応答の形そのものを検査する
function shapeViolations(body: any): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return ['本文が JSON のオブジェクトでない'];
  const v: string[] = [];
  for (const k of Object.keys(body)) if (!TOP_LEVEL.has(k)) v.push(`契約に無い最上位の項目 ${k}`);
  if (typeof body.error !== 'string' || body.error === '') v.push('error が空でない文字列でない');
  if (typeof body.code !== 'string') v.push('code が文字列でない');
  if (typeof body.retryable !== 'boolean') v.push('retryable が真偽値でない');
  return v;
}

// biome-ignore lint/suspicious/noExplicitAny: 応答の形そのものを検査する
function proseOf(body: any): string[] {
  return [
    body.error,
    body.hint,
    ...((body.next_actions ?? []) as Array<{ reason: string }>).map((a) => a.reason),
  ].filter((s): s is string => typeof s === 'string');
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'common-errors-'));
  files.missing = join(dir, 'no-such-file.pdf');
  files.empty = join(dir, 'empty.pdf');
  files.notPdf = join(dir, 'not-a-pdf.pdf');
  files.truncated = join(dir, 'truncated.pdf');
  files.encrypted = join(dir, HALVES_SPECIMENS.failOk.name);
  writeFileSync(files.empty, '');
  writeFileSync(files.notPdf, 'This is a text file, not a PDF.\n');
  const good = readFileSync(FIXTURES.simple);
  // 先頭 3 分の 1: %PDF- はあるが、%%EOF も startxref も無い（§7.5.5）
  writeFileSync(files.truncated, good.subarray(0, Math.floor(good.length / 3)));
  writeFileSync(files.encrypted, Buffer.from(HALVES_SPECIMENS.failOk.base64, 'base64'));

  const server = new McpServer({ name: 'common-errors-test', version: '0' });
  registerAllTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'common-errors-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  // read_url の HTTP の失敗のために、127.0.0.1 で 404 を返す。外の網には触れない
  http = createServer((_req, res) => res.writeHead(404).end('not found'));
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()));
  const address = http.address();
  if (typeof address === 'object' && address) origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await client?.close();
  await new Promise<void>((r) => http.close(() => r()));
});

describe('18 - common-errors', () => {
  it('SPEC-READER-COMMON-ERRORS-001 存在しないパスのエラーが形どおり', async () => {
    const res = await call('get_page_count', { file_path: files.missing });
    expect(res.isError).toBe(true);
    expect(shapeViolations(res.body)).toEqual([]);
  });

  it('SPEC-READER-COMMON-ERRORS-002 存在しないパスは DOC_NOT_FOUND', async () => {
    const res = await call('get_page_count', { file_path: files.missing });
    expect(res.body.code).toBe('DOC_NOT_FOUND');
  });

  it('SPEC-READER-COMMON-ERRORS-002 相対パスは INVALID_ARGUMENT', async () => {
    const res = await call('read_text', { file_path: 'relative/dir/file.pdf' });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('INVALID_ARGUMENT');
  });

  it('SPEC-READER-COMMON-ERRORS-002 範囲外のページは INVALID_ARGUMENT', async () => {
    const pages = Number((await call('get_page_count', { file_path: FIXTURES.simple })).text);
    const res = await call('read_images', { file_path: FIXTURES.simple, pages: String(pages + 4) });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('INVALID_ARGUMENT');
  });

  for (const [kind, label] of [
    ['empty', '0 バイトのファイルは 17 ツールとも INVALID_PDF'],
    ['notPdf', 'PDF でないファイルは 17 ツールとも INVALID_PDF'],
    ['truncated', '途中で切れた PDF は 17 ツールとも INVALID_PDF'],
  ] as const) {
    it(`SPEC-READER-COMMON-ERRORS-003 ${label}`, async () => {
      const got: Record<string, string> = {};
      for (const [tool, args] of Object.entries(FILE_TOOLS)) {
        const res = await call(tool, args(files[kind]));
        got[tool] = res.isError
          ? `${res.body?.code} / ${/finding about the file, not a failure of this server/.test(res.body?.hint ?? '') ? 'hint ok' : `hint: ${res.body?.hint}`}`
          : 'not an error';
      }
      const expected = Object.fromEntries(
        Object.keys(FILE_TOOLS).map((t) => [t, 'INVALID_PDF / hint ok']),
      );
      expect(got).toEqual(expected);
    });
  }

  it('SPEC-READER-COMMON-ERRORS-004 引数の誤りは再試行できる', async () => {
    const res = await call('get_page_count', { file_path: 'relative/file.pdf' });
    expect(res.body.retryable).toBe(true);
  });

  it('SPEC-READER-COMMON-ERRORS-004 存在しないパスは再試行できない', async () => {
    const res = await call('get_page_count', { file_path: files.missing });
    expect(res.body.retryable).toBe(false);
  });

  it('SPEC-READER-COMMON-ERRORS-004 文書の所見は再試行できない', async () => {
    const res = await call('get_page_count', { file_path: files.notPdf });
    expect(res.body.code).toBe('INVALID_PDF');
    expect(res.body.retryable).toBe(false);
  });

  it('SPEC-READER-COMMON-ERRORS-005 どの失敗の文も英語', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['get_page_count', { file_path: files.missing }],
      ['get_page_count', { file_path: files.notPdf }],
      ['get_page_count', { file_path: files.empty }],
      ['get_page_count', { file_path: 'relative/file.pdf' }],
      ['read_images', { file_path: FIXTURES.simple, pages: '999' }],
      ['read_text', { file_path: files.encrypted }],
      ['compare_structure', { file_path_1: FIXTURES.simple, file_path_2: files.notPdf }],
      ['read_url', { url: `${origin}/missing.pdf` }],
    ];
    const japanese: string[] = [];
    for (const [tool, args] of cases) {
      const res = await call(tool, args);
      expect(res.isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
      for (const s of proseOf(res.body)) if (JAPANESE.test(s)) japanese.push(`${tool}: ${s}`);
    }
    expect(japanese).toEqual([]);
  });

  it('SPEC-READER-COMMON-ERRORS-005 next_actions の action の値は変わらない', async () => {
    const res = await call('get_page_count', { file_path: files.missing });
    expect(res.body.next_actions[0].action).toBe('verify_file_path');
  });

  it('SPEC-READER-COMMON-ERRORS-005 HTTP の失敗は verify_url を案内する', async () => {
    const res = await call('read_url', { url: `${origin}/missing.pdf` });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('SOURCE_API_ERROR');
    expect(res.body.retryable).toBe(false);
    expect(res.body.next_actions.map((a: { action: string }) => a.action)).toEqual(['verify_url']);
  });

  it('SPEC-READER-COMMON-ERRORS-006 暗号化文書のエラーは reader が受け取らないことを書く', async () => {
    const res = await call('read_text', { file_path: files.encrypted });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('ENCRYPTED_PDF');
    const hint: string = res.body.hint ?? '';
    expect(hint).toContain('7.6.4.3.2');
    expect(hint).toMatch(/does not take a password/);
    expect(hint).toMatch(/decrypted/);
    expect(hint).not.toMatch(/Supply the user password/i);
  });

  it('SPEC-READER-COMMON-ERRORS-006 locate_objects の reason もパスワードを求めない', async () => {
    const { objects } = await locateObjects(files.encrypted, [1]);
    const reason = objects[0]?.reason ?? '';
    expect(reason).not.toMatch(/Supply the user password/i);
    expect(reason).toMatch(/does not take a password/);
  });
});
