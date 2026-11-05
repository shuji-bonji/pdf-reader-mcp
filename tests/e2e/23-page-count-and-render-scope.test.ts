/**
 * 23 - get_page_count と render_page の射程（openspec/specs/get-page-count・render-page・#41・F-25）
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rendererAvailable } from '../../src/services/page-renderer.js';
import { registerAllTools } from '../../src/tools/index.js';
import { FIXTURES } from './setup.js';

let client: Client;
let dir = '';
const available = await rendererAvailable();

async function call(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  return {
    isError: result.isError === true,
    text: result.content.find((c) => c.type === 'text')?.text ?? '',
    images: result.content.filter((c) => c.type === 'image').length,
  };
}

/** 葉が 2 つで、根の /Count が 3 の文書（R-7.7.3.2-8 に反する書き手の誤り）。 */
function countMismatchPdf(): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ];
  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'page-count-scope-'));
  const server = new McpServer({ name: 'page-count-scope-test', version: '0' });
  registerAllTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'page-count-scope-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
});

describe('23 - get_page_count scope', () => {
  it('SPEC-READER-GET-PAGE-COUNT-001 引数無しでは数値だけ', async () => {
    const res = await call('get_page_count', { file_path: FIXTURES.simple });
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/^\d+$/);
  });

  it('SPEC-READER-GET-PAGE-COUNT-002 JSON では pageCount と scope を返す', async () => {
    const plain = Number((await call('get_page_count', { file_path: FIXTURES.simple })).text);
    const res = await call('get_page_count', {
      file_path: FIXTURES.simple,
      response_format: 'json',
    });
    const body = JSON.parse(res.text);
    expect(body.pageCount).toBe(plain);
    expect(body.scope).toEqual({
      declaredCount: plain,
      pagesReached: plain,
      pageTree: { status: 'read' },
    });
  });

  it('SPEC-READER-GET-PAGE-COUNT-002 /Count が葉の数と違えば両方を返す', async () => {
    const path = join(dir, 'count-mismatch.pdf');
    writeFileSync(path, countMismatchPdf());
    const res = await call('get_page_count', { file_path: path, response_format: 'json' });
    expect(res.isError, res.text).toBe(false);
    const body = JSON.parse(res.text);
    expect(body.scope.declaredCount).toBe(3);
    expect(body.scope.pagesReached).toBe(2);
  });
});

describe.skipIf(!available)('23 - render_page scope', () => {
  it('SPEC-READER-RENDER-PAGE-002 全ページを描画したときも射程の節を出す', async () => {
    const res = await call('render_page', { file_path: FIXTURES.simple, pages: '1' });
    expect(res.isError).toBe(false);
    expect(res.images).toBe(1);
    expect(res.text.startsWith('## Scope of this reading')).toBe(true);
    expect(res.text).toContain('- Pages requested: 1');
    expect(res.text).toContain('- Pages rendered: 1');
    expect(res.text).toContain('- Pages not rendered: none');
  });
});
