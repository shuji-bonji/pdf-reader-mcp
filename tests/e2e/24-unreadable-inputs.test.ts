/**
 * 24 - 読めなかったことを「無い」「故障」と答えない（#49・#50）
 *
 * - openspec/changes/filesystem-errors-are-arguments（#49）: 読み取り権限の無いファイルを
 *   INTERNAL_ERROR で返していた。ファイルシステムのエラーは INVALID_ARGUMENT にする
 * - openspec/changes/catalog-unreadable-is-not-absent（#50）: catalog を読めない文書で
 *   `getCatalog().catch(() => null)` が失敗を null に畳み、「タグが無い」と答えていた
 */

import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerAllTools } from '../../src/tools/index.js';

let client: Client;

// biome-ignore lint/suspicious/noExplicitAny: 応答の形そのものを検査する
type Body = any;

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string; body: Body }> {
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

/** オブジェクトを並べた 1 ページの文書（xref は手で組む） */
function pdf(objects: Array<[number, string]>, trailer: string): Buffer {
  let body = '%PDF-1.7\n';
  const offsets = new Map<number, number>();
  for (const [n, s] of objects) {
    offsets.set(n, body.length);
    body += `${n} 0 obj\n${s}\nendobj\n`;
  }
  const max = Math.max(...objects.map(([n]) => n));
  const xref = body.length;
  body += `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= max; i++) {
    const at = offsets.get(i);
    body +=
      at === undefined ? '0000000000 65535 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n${trailer}\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const PAGES: Array<[number, string]> = [
  [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
  [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>'],
];

const files = { rootMissing: '', rootNotDict: '', rootOk: '', unreadable: '' };
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'unreadable-inputs-'));
  const put = (name: string, bytes: Buffer) => {
    const p = join(dir, name);
    writeFileSync(p, bytes);
    return p;
  };
  // /Root が存在しないオブジェクトを指す
  files.rootMissing = put('root-missing.pdf', pdf(PAGES, '<< /Size 4 /Root 1 0 R >>'));
  // /Root が整数を指す（§7.7.2 の catalog は辞書）
  files.rootNotDict = put(
    'root-not-dict.pdf',
    pdf([[1, '42'], ...PAGES], '<< /Size 4 /Root 1 0 R >>'),
  );
  // 読める catalog。/MarkInfo も /AcroForm も無い
  files.rootOk = put(
    'root-ok.pdf',
    pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], ...PAGES], '<< /Size 4 /Root 1 0 R >>'),
  );
  // 読み取り権限の無いファイル
  files.unreadable = join(dir, 'no-permission.pdf');
  writeFileSync(files.unreadable, Buffer.from('%PDF-1.7\n'));
  chmodSync(files.unreadable, 0o000);

  const server = new McpServer({ name: 'unreadable-inputs-test', version: '0' });
  registerAllTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'unreadable-inputs-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  chmodSync(files.unreadable, 0o600);
  await client?.close();
});

describe('SPEC-READER-COMMON-ERRORS-008 入力を読めないファイルシステムのエラーは INVALID_ARGUMENT にする', () => {
  it.skipIf(isRoot)('SPEC-READER-COMMON-ERRORS-008 読み取り権限の無いファイル', async () => {
    const { isError, body } = await call('get_page_count', { file_path: files.unreadable });
    expect(isError).toBe(true);
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.retryable).toBe(true);
    expect(body.detail?.reason).toBe('PERMISSION_DENIED');
    expect(body.detail?.path).toBe(files.unreadable);
    expect(body.error).toContain(files.unreadable);
  });
});

for (const tool of ['inspect_tags', 'extract_tables'] as const) {
  const id =
    tool === 'inspect_tags' ? 'SPEC-READER-INSPECT-TAGS-002' : 'SPEC-READER-EXTRACT-TABLES-002';
  describe(`${id} catalog を読めない文書ではタグの有無を答えない`, () => {
    it(`${id} Root が指すオブジェクトが無い`, async () => {
      const { isError, body } = await call(tool, {
        file_path: files.rootMissing,
        response_format: 'json',
      });
      expect(isError).toBe(false);
      expect(body.isTagged).toBeNull();
      expect(body.note).toMatch(/catalog/);
    });

    it(`${id} Root が辞書でないものを指す`, async () => {
      const { body } = await call(tool, { file_path: files.rootNotDict, response_format: 'json' });
      expect(body.isTagged).toBeNull();
    });

    it(`${id} 読めた catalog に MarkInfo が無い`, async () => {
      const { body } = await call(tool, { file_path: files.rootOk, response_format: 'json' });
      expect(body.isTagged).toBe(false);
    });
  });
}

describe('SPEC-READER-EXTRACT-STRUCTURED-TEXT-002 catalog を読めない文書では構造木の読み取りを失敗として申告する', () => {
  it('SPEC-READER-EXTRACT-STRUCTURED-TEXT-002 Root が指すオブジェクトが無い', async () => {
    const { isError, body } = await call('extract_structured_text', {
      file_path: files.rootMissing,
      response_format: 'json',
    });
    if (isError) {
      expect(body.code).toBe('INVALID_PDF');
    } else {
      expect(body.isTagged).toBeNull();
      expect(body.scope.textExtraction.status).toBe('failed');
    }
  });
});

describe('SPEC-READER-INSPECT-SIGNATURES-001 catalog を読めない文書では「AcroForm が無い」と答えない', () => {
  it('SPEC-READER-INSPECT-SIGNATURES-001 Root が指すオブジェクトが無い', async () => {
    const { body } = await call('inspect_signatures', {
      file_path: files.rootMissing,
      response_format: 'json',
    });
    expect(body.note).not.toMatch(/No AcroForm/);
    expect(body.note).toMatch(/catalog/);
    expect(body.note).toMatch(/not a document without signatures/);
  });

  it('SPEC-READER-INSPECT-SIGNATURES-001 読めた catalog に AcroForm が無い', async () => {
    const { body } = await call('inspect_signatures', {
      file_path: files.rootOk,
      response_format: 'json',
    });
    expect(body.note).toBe('No AcroForm found in the document.');
  });
});
