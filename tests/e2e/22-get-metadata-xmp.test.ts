/**
 * 22 - get_metadata が XMP を読む（openspec/specs/get-metadata・#42・F-26）
 *
 * 0.19.0 は文書情報辞書（§14.3.3）だけを読み、/Info の無い PDF 2.0 の文書では
 * XMP に題名があっても 8 項目がすべて null だった。
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerAllTools } from '../../src/tools/index.js';
import { buildMetadataPdf, type MetadataSpecimen } from './metadata-specimens.js';
import { FIXTURES } from './setup.js';

let client: Client;
let dir = '';

const TITLE_ALT =
  '><dc:title><rdf:Alt><rdf:li xml:lang="x-default">請求書 INV-2026-0915</rdf:li>' +
  '<rdf:li xml:lang="en">Invoice INV-2026-0915</rdf:li></rdf:Alt></dc:title>';

function specimen(name: string, spec: MetadataSpecimen): string {
  const path = join(dir, `${name}.pdf`);
  writeFileSync(path, buildMetadataPdf(spec));
  return path;
}

// biome-ignore lint/suspicious/noExplicitAny: 応答の形そのものを検査する
async function metadata(path: string, format: 'json' | 'markdown' = 'json'): Promise<any> {
  const result = (await client.callTool({
    name: 'get_metadata',
    arguments: { file_path: path, response_format: format },
  })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  const text = result.content.find((c) => c.type === 'text')?.text ?? '';
  expect(result.isError, text).not.toBe(true);
  return format === 'json' ? JSON.parse(text) : text;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'metadata-xmp-'));
  const server = new McpServer({ name: 'metadata-xmp-test', version: '0' });
  registerAllTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'metadata-xmp-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
});

describe('22 - get_metadata reads XMP', () => {
  it('SPEC-READER-GET-METADATA-001 文書情報辞書の無い PDF 2.0 の文書で題名を XMP から読む', async () => {
    const m = await metadata(specimen('xmp-only', { version: '2.0', xmp: TITLE_ALT }));
    expect(m.pdfVersion).toBe('2.0');
    expect(m.title).toBe('請求書 INV-2026-0915');
    expect(m.metadataSources.title).toBe('xmp');
  });

  it('SPEC-READER-GET-METADATA-001 言語ごとの題名は x-default を使う', async () => {
    const xmp =
      '><dc:title><rdf:Alt><rdf:li xml:lang="en">English</rdf:li>' +
      '<rdf:li xml:lang="x-default">Default</rdf:li></rdf:Alt></dc:title>';
    const m = await metadata(specimen('alt', { version: '2.0', xmp }));
    expect(m.title).toBe('Default');
  });

  it('SPEC-READER-GET-METADATA-001 属性の形で書かれたプロパティも読む', async () => {
    const xmp = ' xmp:CreatorTool="Word &amp; Co" pdf:Producer="Prod X">';
    const m = await metadata(specimen('attr', { version: '2.0', xmp }));
    expect(m.creator).toBe('Word & Co');
    expect(m.metadataSources.creator).toBe('xmp');
    expect(m.producer).toBe('Prod X');
  });

  it('SPEC-READER-GET-METADATA-001 複数の作成者は区切ってつなぐ', async () => {
    const xmp =
      '><dc:creator><rdf:Seq><rdf:li>John Doe</rdf:li><rdf:li>Mary Miller</rdf:li></rdf:Seq></dc:creator>';
    const m = await metadata(specimen('seq', { version: '2.0', xmp }));
    expect(m.author).toBe('John Doe; Mary Miller');
  });

  it('SPEC-READER-GET-METADATA-002 PDF 2.0 では XMP の値を使い、食い違いを返す', async () => {
    const xmp = '><dc:title><rdf:Alt><rdf:li xml:lang="x-default">B</rdf:li></rdf:Alt></dc:title>';
    const m = await metadata(
      specimen('conflict-20', { version: '2.0', info: { Title: 'A' }, xmp }),
    );
    expect(m.title).toBe('B');
    expect(m.metadataSources.title).toBe('xmp');
    expect(m.metadataConflicts).toEqual([{ field: 'title', info: 'A', xmp: 'B' }]);
    const md = await metadata(
      specimen('conflict-20-md', { version: '2.0', info: { Title: 'A' }, xmp }),
      'markdown',
    );
    expect(md).toContain('## Values that differ between the two sources');
    expect(md).toContain('| title | A | B |');
  });

  it('SPEC-READER-GET-METADATA-002 PDF 1.7 では文書情報辞書の値を使う', async () => {
    const xmp = '><dc:title><rdf:Alt><rdf:li xml:lang="x-default">B</rdf:li></rdf:Alt></dc:title>';
    const m = await metadata(
      specimen('conflict-17', { version: '1.7', info: { Title: 'A' }, xmp }),
    );
    expect(m.title).toBe('A');
    expect(m.metadataSources.title).toBe('info');
    expect(m.metadataConflicts).toEqual([{ field: 'title', info: 'A', xmp: 'B' }]);
  });

  it('SPEC-READER-GET-METADATA-002 同じ時刻を別の書き方で書いた日付は食い違いにしない', async () => {
    const xmp =
      '><xmp:CreateDate>2026-09-15T10:00:00+09:00</xmp:CreateDate>' +
      '<xmp:ModifyDate>2026-09-16T00:00:00Z</xmp:ModifyDate>';
    const m = await metadata(
      specimen('dates', {
        version: '1.7',
        info: { CreationDate: "D:20260915100000+09'00'", ModDate: "D:20260916000000+09'00'" },
        xmp,
      }),
    );
    expect(m.creationDate).toBe("D:20260915100000+09'00'");
    // 作成日は同じ時刻なので食い違いにしない。更新日は 9 時間ずれているので食い違い
    expect(m.metadataConflicts.map((c: { field: string }) => c.field)).toEqual([
      'modificationDate',
    ]);
  });

  it('SPEC-READER-GET-METADATA-003 /Metadata の無い文書は absent', async () => {
    const m = await metadata(specimen('no-xmp', { version: '1.7', info: { Title: 'A' } }));
    expect(m.xmpMetadata).toEqual({ status: 'absent' });
    expect(m.metadataSources.title).toBe('info');
  });

  it('SPEC-READER-GET-METADATA-003 XMP のある文書は read', async () => {
    const m = await metadata(specimen('with-xmp', { version: '2.0', xmp: TITLE_ALT }));
    expect(m.xmpMetadata).toEqual({ status: 'read' });
  });

  it('既存の検体の題名は変わらない（PDF 1.x・/Info のみ）', async () => {
    const m = await metadata(FIXTURES.simple);
    expect(m.metadataSources.title === 'info' || m.title === null).toBe(true);
  });
});
