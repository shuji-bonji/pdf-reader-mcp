/**
 * 15 - どこまで読めたかを申告する（#26）
 *
 * テキストを返すツールは 2 つの別々の問いに答えている。
 *
 *   1. 文字を取り出せたか（pdfjs）
 *   2. その文字が Unicode に変換できるか（ISO 32000-2 §9.10.1・pdf-lib）
 *
 * 0.13.0 まで、この 2 本は `Promise.all` に入っていた。`Promise.all` は先に
 * 失敗したほうの理由で拒否するので、片方が成功していてもその結果ごと捨てられ、
 * どちらが失敗したのかも出力に残らなかった。
 *
 * 🔴 この試験が守っているのは「読めなかったこと」と「読んで無かったこと」の区別で、
 * 文言ではない。`null` を `0` や `''` や `false` に変えると落ちる。
 *
 * ## 2026-08-31（S3・pdf-lib 撤去）以降、実ファイルで出るのは 2 通りである
 *
 * 検体は 4 通りを 1 件ずつ持つように作ってあるが、観測側の読み手が
 * `@normativepdf/recover` に変わったことで、混ざった 2 通りが出なくなった。
 *
 * | 検体 | pdf-lib のとき | recover のいま |
 * |---|---|---|
 * | `halves-ok-fail-header.pdf` | ok/fail（版の数が無いヘッダで pdf-lib が止まる） | **ok/ok**（recover は読む） |
 * | `halves-fail-ok-password.pdf` | fail/ok（`ignoreEncryption` で構造だけ歩けた） | **fail/fail**（鍵が導けないと 1 つも読めない・ADR-0008） |
 *
 * 混ざった 2 通りを作れないか実測した（ヘッダ無し・`/Count` 不一致・版の無い
 * ヘッダ）が、3 つとも両方の半分が成功した。recover は pdfjs より厳しくない。
 *
 * 🔴 **検体が無いことは、規約が要らなくなったことではない。** 混ざった 2 通りの
 * 規約は `tests/tier1/reading-scope.test.ts` が stub で固定している。
 * ここは実ファイルで出る 2 通りだけを測る。
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ResponseFormat } from '../../src/constants.js';
import { HALVES_SPECIMENS } from './halves-specimens.js';

type ToolResult = { content: Array<{ text?: string }>; isError?: boolean };
type Handler = (params: unknown) => Promise<ToolResult>;

/** 登録されたハンドラを 1 本だけ取り出す（14-next-hints と同じやり方）。 */
async function handlerOf(register: (server: never) => void): Promise<Handler> {
  let handler: Handler | null = null;
  const server = {
    registerTool: (_name: string, _def: unknown, fn: Handler) => {
      handler = fn;
    },
  } as never;
  register(server);
  if (!handler) throw new Error('tool did not register');
  return handler;
}

async function callTool(name: string, params: Record<string, unknown>) {
  const mod = {
    read_text: async () => (await import('../../src/tools/tier1/read-text.js')).registerReadText,
    read_url: async () => (await import('../../src/tools/tier1/read-url.js')).registerReadUrl,
    search_text: async () =>
      (await import('../../src/tools/tier1/search-text.js')).registerSearchText,
    summarize: async () => (await import('../../src/tools/tier1/summarize.js')).registerSummarize,
    extract_structured_text: async () =>
      (await import('../../src/tools/tier2/extract-structured-text.js'))
        .registerExtractStructuredText,
  }[name];
  if (!mod) throw new Error(`unknown tool: ${name}`);
  const handler = await handlerOf((await mod()) as never);
  const result = await handler({ ...params, response_format: ResponseFormat.JSON });
  return {
    isError: result.isError === true,
    // biome-ignore lint/suspicious/noExplicitAny: 応答の形そのものを検査する
    body: JSON.parse(result.content[0]?.text ?? '{}') as any,
  };
}

const paths: Record<keyof typeof HALVES_SPECIMENS, string> = {} as never;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'halves-'));
  for (const [key, spec] of Object.entries(HALVES_SPECIMENS)) {
    const bytes = Buffer.from(spec.base64, 'base64');
    // 🔴 バイト列が変わっていたら、この試験が測っているものも変わっている
    expect(createHash('sha256').update(bytes).digest('hex').slice(0, 32)).toBe(spec.sha256);
    const p = join(dir, spec.name);
    writeFileSync(p, bytes);
    (paths as Record<string, string>)[key] = p;
  }
});

/**
 * read_url のために、検体を 127.0.0.1 に配る。外の網には触れない。
 * 🔴 pdfjs は渡された配列の中身を worker へ移す。移したあと同じ配列を読む 2 人目には
 * 0 バイトに見えるので、0.13.0 の read_url は**全検体で**「No PDF header found」を
 * 返していた。ここはその回帰を捕まえる。
 */
let server: Server;
let origin = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const key = decodeURIComponent((req.url ?? '').replace(/^\//, ''));
    const p = (paths as Record<string, string>)[key];
    if (!p) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = readFileSync(p);
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': body.length });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const address = server.address();
  if (typeof address === 'object' && address) origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('15 - reading scope', () => {
  // ---- ok/ok ----
  it('RS-1: 両方読めたときも scope を出す（欠けたときだけ出る行は読み飛ばされる）', async () => {
    const { isError, body } = await callTool('read_text', { file_path: paths.okOk });
    expect(isError).toBe(false);
    expect(body.scope.textExtraction.status).toBe('read');
    expect(body.scope.extractabilityObservation.status).toBe('read');
    expect(body.pages).toHaveLength(2);
  });

  it('RS-2: ページごとに答えが違うことがそのまま出る', async () => {
    const { body } = await callTool('read_text', { file_path: paths.okOk });
    expect(body.pages[0].extractability.state).toBe('extracted');
    expect(body.pages[1].extractability.state).toBe('not_observed');
    // 2 ページ目は「観測できなかった」であって「文字が無い」ではない。
    // 文字が 0 字だったことは text: '' が言う（null ではない）。
    expect(body.pages[1].text).toBe('');
    expect(body.pages[1].extractability.reason).toBeTruthy();
  });

  // ---- 版の数が無いヘッダ（pdf-lib のときは ok/fail だった） ----
  it('RS-3: 版の数が無いヘッダは、いま両方の半分が読む（§7.5.2）', async () => {
    const { isError, body } = await callTool('read_text', { file_path: paths.okFail });
    expect(isError).toBe(false);
    expect(body.scope.textExtraction.status).toBe('read');
    // 🔴 pdf-lib はここで版の数を読もうとして止まっていた。recover は読む。
    expect(body.scope.extractabilityObservation.status).toBe('read');
    expect(body.pages[0].text).toContain('One page with readable text');
    expect(body.pages[0].extractability.state).toBe('extracted');
  });

  it('RS-4: 観測が読めたときは、そのページに観測の欄が付く', async () => {
    const { body } = await callTool('read_text', { file_path: paths.okFail });
    // 0 を並べた観測を作らないことは変わらない —— 観測できたから数が入っている。
    expect(body.pages[0].extractability.textShowingOperators).toBe(1);
    expect(body.pages[0].extractability.fontsUsed).toBe(1);
  });

  // ---- 鍵が導けない文書（pdf-lib のときは fail/ok だった） ----
  it('RS-5: 鍵が導けない文書は、ページ数を 0 と書かずに両方の失敗を返す', async () => {
    const { isError, body } = await callTool('read_text', { file_path: paths.failOk });
    // 🔴 recover は鍵が導けないと間接オブジェクトを 1 つも渡さない（ADR-0008）ので、
    // ページ数も分からない。`pages: []` を返すと「この文書にページは無い」と
    // 言ったことになる —— それはこの試験が分けようとしている混同そのものである。
    expect(isError).toBe(true);
    expect(body.pages).toBeUndefined();
    const cause: string = body.detail?.cause ?? '';
    expect(cause).toContain('text extraction: ENCRYPTED_PDF');
    expect(cause).toContain('extractability observation: ENCRYPTED_PDF');
  });

  it('RS-6: 鍵が導けないことを、暗号化 PDF に対応していないと言い換えない', async () => {
    const { body } = await callTool('read_text', { file_path: paths.failOk });
    const hint: string = body.hint ?? '';
    expect(hint).toContain('7.6.4.3.2');
    expect(hint).not.toContain('サポートしていません');
    // 観測が「続いている」とも書かない —— 続いていない。
    expect(hint).not.toContain('続けています');
  });

  // ---- fail/fail ----
  it('RS-7: どちらも読めないときだけエラーにし、2 つの理由を両方載せる', async () => {
    const { isError, body } = await callTool('read_text', { file_path: paths.failFail });
    expect(isError).toBe(true);
    const cause: string = body.detail?.cause ?? '';
    expect(cause).toContain('text extraction:');
    expect(cause).toContain('extractability observation:');
  });

  it('RS-8: 同じ入力に何度投げても同じコードが返る（先に失敗したほうで決まらない）', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const { body } = await callTool('read_text', { file_path: paths.failFail });
      codes.add(body.code);
    }
    expect([...codes]).toHaveLength(1);
  });

  // ---- ほかのツールも同じ規約 ----
  it('RS-9: search_text は「探せなかった」を 0 件と書かない', async () => {
    const { isError, body } = await callTool('search_text', {
      file_path: paths.failOk,
      query: 'text',
    });
    expect(isError).toBe(true);
    // 🔴 0 件は「探して見つからなかった」であり、ここでは探せていない。
    expect(body.totalMatches).toBeUndefined();
    expect(body.matches).toBeUndefined();
  });

  it('RS-10: search_text は探せたときは数を返す', async () => {
    const { body } = await callTool('search_text', { file_path: paths.okFail, query: 'readable' });
    expect(body.scope.textExtraction.status).toBe('read');
    expect(body.totalMatches).toBe(1);
  });

  it('RS-11: summarize は読まなかった項目を 0 や false で埋めない', async () => {
    const { isError, body } = await callTool('summarize', { file_path: paths.failOk });
    expect(isError).toBe(true);
    const text = JSON.stringify(body);
    expect(text).not.toContain('"imageCount":0');
    expect(text).not.toContain('"hasText":false');
    expect(text).not.toContain('"pageCount":0');
  });

  it('RS-12: summarize は観測できなかった前提から next を出さない', async () => {
    const { body } = await callTool('summarize', { file_path: paths.failOk });
    expect(body.next).toBeUndefined();
  });

  it('RS-14: read_url は取ってきた文書の文字を返す（配列を使い回して空にしない）', async () => {
    const { isError, body } = await callTool('read_url', { url: `${origin}/okOk` });
    expect(isError).toBe(false);
    expect(body.scope.textExtraction.status).toBe('read');
    expect(body.scope.extractabilityObservation.status).toBe('read');
    expect(body.pages[0].text).toContain('Page one has text');
    // 観測も同じバイト列から行われている。片方が空を読んでいたらここが落ちる。
    expect(body.pages[0].extractability.state).toBe('extracted');
  });

  it('RS-15: read_url も read_text と同じ規約に従う', async () => {
    const locked = await callTool('read_url', { url: `${origin}/failOk` });
    expect(locked.isError).toBe(true);
    expect(String(locked.body.detail?.cause ?? '')).toContain('extractability observation:');
    const bad = await callTool('read_url', { url: `${origin}/failFail` });
    expect(bad.isError).toBe(true);
    expect(String(bad.body.detail?.cause ?? '')).toContain('extractability observation:');
  });

  it('RS-13: extract_structured_text は「読めなかった」をタグ無しと書かない', async () => {
    const { isError, body } = await callTool('extract_structured_text', {
      file_path: paths.okOk,
    });
    expect(isError).toBe(false);
    expect(body.scope.textExtraction.status).toBe('read');
    expect(typeof body.isTagged).toBe('boolean');
  });
});
