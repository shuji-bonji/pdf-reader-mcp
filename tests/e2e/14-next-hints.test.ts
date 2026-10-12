/**
 * 14 - summarize's `next` suggestions (#24)
 *
 * The field is advice derived from observations, so the tests pin the
 * DERIVATION, not the wording: given this observation, a suggestion naming
 * that tool appears; absent the observation, it does not.
 */
import { describe, expect, it } from 'vitest';
import { ResponseFormat } from '../../src/constants.js';
import { suggestNext } from '../../src/tools/tier1/summarize.js';
import type { PdfMetadata } from '../../src/types.js';
import { FIXTURES } from './setup.js';

const META: PdfMetadata = {
  title: null,
  author: null,
  subject: null,
  keywords: null,
  creator: null,
  producer: null,
  creationDate: null,
  modificationDate: null,
  pageCount: 3,
  pdfVersion: '1.7',
  isLinearized: false,
  isEncrypted: false,
  isTagged: true,
  hasSignatures: false,
  fileSize: 1,
};

/** Run the summarize tool handler the way the server would. */
async function summarize(filePath: string): Promise<{
  next: string[];
  textExtractability: string;
  declaredConformance: {
    pdfaid: { part: number | null; conformance: string | null } | null;
    pdfuaid: { part: number | null } | null;
    tdm: { reservation: number | null; policy: string | null } | null;
  } | null;
  scope: { xmpDeclarations: { status: string } };
}> {
  const { McpServer } = await import('@modelcontextprotocol/server');
  const { registerSummarize } = await import('../../src/tools/tier1/summarize.js');

  let handler: ((params: unknown) => Promise<{ content: Array<{ text?: string }> }>) | null = null;
  const server = {
    registerTool: (_name: string, _def: unknown, fn: typeof handler) => {
      handler = fn;
    },
  } as unknown as InstanceType<typeof McpServer>;
  registerSummarize(server);
  if (!handler) throw new Error('summarize did not register');
  const result = await (handler as NonNullable<typeof handler>)({
    file_path: filePath,
    response_format: ResponseFormat.JSON,
  });
  return JSON.parse(result.content[0].text ?? '{}');
}

describe('14 - summarize next hints', () => {
  // NH-1: 画像だけの文書 → render_page を指す
  it('NH-1: an image-only document points at render_page', async () => {
    const summary = await summarize(FIXTURES.noTextLayer);
    expect(summary.textExtractability).toBe('no_text_layer');
    expect(summary.next.some((line) => line.includes('render_page'))).toBe(true);
  });

  // NH-2: タグ付き文書 → extract_structured_text / extract_tables を指す
  it('NH-2: a tagged document points at the structure tools', async () => {
    const summary = await summarize(FIXTURES.structured);
    expect(summary.next.some((line) => line.includes('extract_structured_text'))).toBe(true);
    expect(summary.next.some((line) => line.includes('extract_tables'))).toBe(true);
  });

  // NH-3: 普通の短い文書 → 何も勧めない（常に出る助言は読まれなくなる）
  it('NH-3: a small ordinary document gets no advice', async () => {
    const summary = await summarize(FIXTURES.simple);
    expect(summary.next).toEqual([]);
  });

  // NH-4: 暗号化文書 → 復号できたかどうかで助言が変わる
  it('NH-4: an encrypted document that was read does not ask for decryption', async () => {
    const summary = await summarize(FIXTURES.encryptedActualText);
    // この検体は空の利用者パスワードで鍵が導ける（ISO 32000-2 §7.6.4.3.2）ので、復号して読める。
    expect(summary.textExtractability).toBe('extracted');
    expect(summary.next.some((line) => line.includes('isEncrypted'))).toBe(true);
    // 🔴 全文が読めている文書に「復号してから出直せ」と言わない。
    expect(summary.next.some((line) => line.includes('Decrypt the file first'))).toBe(false);
    // 🔴 暗号化を理由にほかの助言を伏せない —— この検体はタグ付きでもある。
    expect(summary.next.some((line) => line.includes('isTagged'))).toBe(true);
  });

  // NH-5: 助言は前提の観測名を名乗る（読む側が premise を検証できる）
  it('NH-5: every suggestion names the observation it follows from', async () => {
    const summary = await summarize(FIXTURES.noTextLayer);
    for (const line of summary.next) {
      expect(line).toMatch(/textExtractability|isTagged|pageCount|isEncrypted|declaredConformance/);
    }
  });

  // NH-6 (#29): XMP の PDF/UA 宣言は、MarkInfo とは別に summarize から見える
  it('NH-6: a PDF/UA declaration in XMP is reported and points at the structure route', async () => {
    const summary = await summarize(FIXTURES.catalogFeatures);
    expect(summary.scope.xmpDeclarations.status).toBe('read');
    expect(summary.declaredConformance).toEqual({
      pdfaid: { part: 3, conformance: 'B' },
      pdfuaid: { part: 1 },
      tdm: { reservation: 1, policy: 'https://example.org/tdm-policy' },
    });
    const line = summary.next.find((l) => l.startsWith('declaredConformance.pdfuaid'));
    expect(line).toBeDefined();
    // この検体は MarkInfo を持たないので、宣言とカタログの食い違いとして出る。
    expect(line).toContain('MarkInfo /Marked is not true');
    // 文言は「宣言」で止める。検証した顔をさせない。
    expect(line).toContain('declares PDF/UA-1');
    expect(line).toContain('validate_conformance');
  });

  // NH-7 (#29): /Metadata が無い文書は「宣言が無い」であって「読めなかった」ではない
  it('NH-7: no /Metadata means all-null declarations with the reading done', async () => {
    const summary = await summarize(FIXTURES.simple);
    expect(summary.scope.xmpDeclarations.status).toBe('read');
    expect(summary.declaredConformance).toEqual({ pdfaid: null, pdfuaid: null, tdm: null });
  });

  // NH-8 (#29): 宣言とカタログが一致するとき、構造経路を先に勧める 1 行が出る
  it('NH-8: PDF/UA declared and MarkInfo marked → structure route first, verification elsewhere', () => {
    const next = suggestNext(META, 'extracted', [], {
      pdfaid: null,
      pdfuaid: { part: 2 },
      tdm: null,
    });
    const line = next.find((l) => l.startsWith('declaredConformance.pdfuaid'));
    expect(line).toContain('declares PDF/UA-2');
    expect(line).toContain('take the structure route first');
    expect(line).toContain('validate_conformance');
    expect(line).not.toContain('disagree');
  });

  // NH-9 (#29): 宣言が無ければ、この行は出ない（isTagged の行だけ）
  it('NH-9: no declaration → no declaredConformance line', () => {
    const next = suggestNext(META, 'extracted', [], { pdfaid: null, pdfuaid: null, tdm: null });
    expect(next.some((l) => l.startsWith('declaredConformance'))).toBe(false);
    expect(next.some((l) => l.startsWith('isTagged'))).toBe(true);
  });
});
