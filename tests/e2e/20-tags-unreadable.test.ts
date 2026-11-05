/**
 * 20 - 鍵を導けない暗号化文書で「タグが無い」と答えない（#39・F-01）
 *
 * openspec/specs/inspect-tags・extract-tables・extract-structured-text の 001。
 * 0.19.0 は、鍵を導けないので catalog を読めなかった結果を `/MarkInfo /Marked` が
 * false だった、として使い、3 ツールとも「タグが無い」と答えていた。
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerAllTools } from '../../src/tools/index.js';
import { LOCKED_TAGGED_TABLE } from './locked-specimens.js';
import { FIXTURES } from './setup.js';

let client: Client;
let locked = '';

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

const UNREAD = /could not be derived[\s\S]*not a document without tags/;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tags-unreadable-'));
  locked = join(dir, LOCKED_TAGGED_TABLE.name);
  writeFileSync(locked, Buffer.from(LOCKED_TAGGED_TABLE.base64, 'base64'));
  const server = new McpServer({ name: 'tags-unreadable-test', version: '0' });
  registerAllTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'tags-unreadable-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
});

describe('20 - tags unreadable when the key cannot be derived', () => {
  it('SPEC-READER-INSPECT-TAGS-001 鍵を導けない文書では isTagged が null', async () => {
    const res = await call('inspect_tags', { file_path: locked, response_format: 'json' });
    expect(res.isError).toBe(false);
    expect(res.body.isTagged).toBeNull();
    expect(res.body.totalElements).toBeNull();
    expect(res.body.maxDepth).toBeNull();
    expect(res.body.roleCounts).toBeNull();
    expect(res.body.note).toMatch(UNREAD);
  });

  it('SPEC-READER-INSPECT-TAGS-001 markdown でもタグが無いとは書かない', async () => {
    const res = await call('inspect_tags', { file_path: locked });
    expect(res.text).not.toMatch(/not tagged/i);
    expect(res.text).not.toContain('**Tagged**: No');
    expect(res.text).toMatch(UNREAD);
  });

  it('SPEC-READER-INSPECT-TAGS-001 タグの無い暗号化されていない文書は今までどおり false', async () => {
    const res = await call('inspect_tags', { file_path: FIXTURES.simple, response_format: 'json' });
    expect(res.body.isTagged).toBe(false);
  });

  it('SPEC-READER-EXTRACT-TABLES-001 鍵を導けない文書では isTagged と tables が null', async () => {
    const res = await call('extract_tables', { file_path: locked, response_format: 'json' });
    expect(res.isError).toBe(false);
    expect(res.body.isTagged).toBeNull();
    expect(res.body.tables).toBeNull();
    expect(res.body.totalTables).toBeNull();
    expect(res.body.note).toMatch(UNREAD);
    expect(res.body.note).not.toMatch(/column-aware/);
    const md = await call('extract_tables', { file_path: locked });
    expect(md.text).not.toContain('**Tagged**: No');
    expect(md.text).not.toContain('No tables were extracted');
  });

  it('SPEC-READER-EXTRACT-TABLES-001 タグの無い暗号化されていない文書は今までどおり false', async () => {
    const res = await call('extract_tables', {
      file_path: FIXTURES.simple,
      response_format: 'json',
    });
    expect(res.body.isTagged).toBe(false);
    expect(res.body.tables).toEqual([]);
  });

  it('SPEC-READER-EXTRACT-STRUCTURED-TEXT-001 鍵を導けない文書では ENCRYPTED_PDF のエラーになる', async () => {
    const res = await call('extract_structured_text', {
      file_path: locked,
      response_format: 'json',
    });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('ENCRYPTED_PDF');
  });

  it('暗号化していない同じ文書は表を読める（検体の前提）', async () => {
    const res = await call('extract_tables', {
      file_path: FIXTURES.spanningTable,
      response_format: 'json',
    });
    expect(res.body.isTagged).toBe(true);
    expect(res.body.totalTables).toBeGreaterThan(0);
  });
});
