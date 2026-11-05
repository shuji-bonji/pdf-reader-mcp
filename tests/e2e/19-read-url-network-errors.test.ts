/**
 * 19 - read_url のネットワークの失敗（openspec/specs/common-errors の 007・#46）
 *
 * 作った文ではなく、実際の `fetch` の失敗で確かめる。0.19.0 までの単体テストは
 * `new Error('connect ECONNREFUSED ...')` のような文で確かめていたので、本物の
 * `fetch` が投げる `TypeError: fetch failed`（理由は `cause.code` にだけある）を
 * 一度も通っていなかった。外の網には触れない（127.0.0.1 と `.invalid` だけ）。
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchPdfFromUrlUnlimited } from '../../src/services/url-fetcher.js';
import { registerAllTools } from '../../src/tools/index.js';
import { handleStructuredError } from '../../src/utils/error-handler.js';

const TLS = join(process.cwd(), 'tests', 'e2e', 'tls-specimens');
const servers: Server[] = [];
let client: Client;

// biome-ignore lint/suspicious/noExplicitAny: 応答の形そのものを検査する
async function readUrl(url: string): Promise<{ isError: boolean; body: any }> {
  const result = (await client.callTool({ name: 'read_url', arguments: { url } })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  const text = result.content.find((c) => c.type === 'text')?.text ?? '';
  return { isError: result.isError === true, body: JSON.parse(text) };
}

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('no address');
  return `127.0.0.1:${address.port}`;
}

function httpsWith(name: string): Server {
  return createHttpsServer(
    {
      key: readFileSync(join(TLS, `${name}.key`)),
      cert: readFileSync(join(TLS, `${name}.pem`)),
    },
    (_req, res) => res.end('%PDF-'),
  );
}

/** 一度開いて閉じたポート。接続を拒まれる。 */
async function closedPort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const address = s.address();
  await new Promise<void>((r) => s.close(() => r()));
  if (typeof address !== 'object' || !address) throw new Error('no address');
  return address.port;
}

beforeAll(async () => {
  const server = new McpServer({ name: 'read-url-network-test', version: '0' });
  registerAllTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'read-url-network-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const s of servers) {
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

describe('19 - read_url network errors', () => {
  it('SPEC-READER-COMMON-ERRORS-007 接続を拒まれると SOURCE_UNAVAILABLE', async () => {
    const res = await readUrl(`http://127.0.0.1:${await closedPort()}/x.pdf`);
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('SOURCE_UNAVAILABLE');
    expect(res.body.retryable).toBe(true);
    expect(res.body.detail.cause).toContain('ECONNREFUSED');
    expect(res.body.next_actions.map((a: { action: string }) => a.action)).toEqual([
      'verify_url',
      'retry_later',
    ]);
  });

  it('SPEC-READER-COMMON-ERRORS-007 名前を引けないと SOURCE_UNAVAILABLE', async () => {
    const res = await readUrl('http://no-such-host.invalid/x.pdf');
    expect(res.body.code).toBe('SOURCE_UNAVAILABLE');
    expect(res.body.retryable).toBe(true);
  });

  it('SPEC-READER-COMMON-ERRORS-007 応答が来ないまま時間切れになると SOURCE_TIMEOUT', async () => {
    // 接続は受けるが応答を返さない。30 秒は待たず、取得の関数に短い時間切れを渡す
    const host = await listen(createHttpServer(() => {}));
    let err: ReturnType<typeof handleStructuredError> | undefined;
    try {
      await fetchPdfFromUrlUnlimited(`http://${host}/x.pdf`, { timeoutMs: 200 });
    } catch (error) {
      err = handleStructuredError(error);
    }
    expect(err?.code).toBe('SOURCE_TIMEOUT');
    expect(err?.retryable).toBe(true);
    expect(err?.next_actions?.map((a) => a.action)).toEqual(['retry_later']);
  });

  it('SPEC-READER-COMMON-ERRORS-007 証明書を検証できないと SOURCE_API_ERROR', async () => {
    const host = await listen(httpsWith('self-signed'));
    const res = await readUrl(`https://${host}/x.pdf`);
    expect(res.body.code).toBe('SOURCE_API_ERROR');
    expect(res.body.retryable).toBe(false);
    expect(res.body.detail.cause).toContain('DEPTH_ZERO_SELF_SIGNED_CERT');
    expect(res.body.next_actions.map((a: { action: string }) => a.action)).toEqual(['verify_url']);
  });

  it('SPEC-READER-COMMON-ERRORS-007 証明書の期限が切れていると SOURCE_API_ERROR', async () => {
    const host = await listen(httpsWith('expired'));
    const res = await readUrl(`https://${host}/x.pdf`);
    expect(res.body.code).toBe('SOURCE_API_ERROR');
    expect(res.body.detail.cause).toContain('CERT_HAS_EXPIRED');
  });

  it('SPEC-READER-COMMON-ERRORS-007 証明書の名前が合わないと SOURCE_API_ERROR', async () => {
    // テスト用の CA を信頼させないと、名前の検査の前に「CA を検証できない」で止まる。
    // NODE_EXTRA_CA_CERTS は起動時にしか読まれないので子プロセスで取得する。
    const host = await listen(httpsWith('wrong-name'));
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--import',
        'tsx',
        join(process.cwd(), 'tests', 'e2e', 'tls-fetch-child.ts'),
        `https://${host}/x.pdf`,
      ],
      { env: { ...process.env, NODE_EXTRA_CA_CERTS: join(TLS, 'ca.pem') }, timeout: 30_000 },
    );
    const body = JSON.parse(stdout);
    expect(body.code).toBe('SOURCE_API_ERROR');
    expect(body.detail.cause).toContain('ERR_TLS_CERT_ALTNAME_INVALID');
  });

  it('SPEC-READER-COMMON-ERRORS-007 fetch が断るポートは INVALID_ARGUMENT', async () => {
    const res = await readUrl('http://127.0.0.1:9/x.pdf');
    expect(res.body.code).toBe('INVALID_ARGUMENT');
    expect(res.body.retryable).toBe(true);
  });
});
