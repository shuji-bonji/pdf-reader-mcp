/**
 * tools/list が返すツールの集合（openspec/specs/tools-list）。
 *
 * サービス層ではなく、MCP の tools/list の実応答で測る。登録の漏れや
 * 消し忘れは、サービスを直接呼ぶテストには写らない。
 * 組み方は scripts/golden.mjs と同じ（registerAllTools を InMemoryTransport 越しに呼ぶ）。
 */

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerAllTools } from '../../src/tools/index.js';

/** SPEC-READER-TOOLS-LIST-001 が列挙する 18 ツール。 */
const EXPECTED = [
  // 基本
  'read_text',
  'read_url',
  'read_images',
  'render_page',
  'search_text',
  'get_metadata',
  'get_page_count',
  'summarize',
  // 構造
  'inspect_structure',
  'inspect_catalog',
  'inspect_fonts',
  'inspect_annotations',
  'inspect_signatures',
  'inspect_tags',
  'extract_tables',
  'extract_structured_text',
  'locate_objects',
  // 比較
  'compare_structure',
];

describe('tools/list', () => {
  let client: Client;
  let names: string[];

  beforeAll(async () => {
    const server = new McpServer({ name: 'tools-list-test', version: '0' });
    registerAllTools(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'tools-list-test', version: '0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    names = (await client.listTools()).tools.map((t) => t.name);
  });

  afterAll(async () => {
    await client.close();
  });

  it('SPEC-READER-TOOLS-LIST-001 tools/list の名前の集合が 18 ツールと一致する', () => {
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...EXPECTED].sort());
  });

  it('SPEC-READER-TOOLS-LIST-001 削除した 2 ツールは tools/list に無い', () => {
    expect(names).not.toContain('validate_tagged');
    expect(names).not.toContain('validate_metadata');
  });

  it('SPEC-READER-TOOLS-LIST-002 validate_ で始まるツールが無い', () => {
    expect(names.filter((n) => n.startsWith('validate_'))).toEqual([]);
  });
});
