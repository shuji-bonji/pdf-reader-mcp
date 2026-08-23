/**
 * 14 - summarize's `next` suggestions (#24)
 *
 * The field is advice derived from observations, so the tests pin the
 * DERIVATION, not the wording: given this observation, a suggestion naming
 * that tool appears; absent the observation, it does not.
 */
import { describe, expect, it } from 'vitest';
import { ResponseFormat } from '../../src/constants.js';
import { FIXTURES } from './setup.js';

/** Run the summarize tool handler the way the server would. */
async function summarize(filePath: string): Promise<{
  next: string[];
  textExtractability: string;
}> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
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

  // NH-4: 暗号化文書 → 復号が先、以外を勧めない
  it('NH-4: an encrypted document says decrypt first, and only that', async () => {
    const summary = await summarize(FIXTURES.encryptedActualText);
    expect(summary.next).toHaveLength(1);
    expect(summary.next[0]).toContain('isEncrypted');
  });

  // NH-5: 助言は前提の観測名を名乗る（読む側が premise を検証できる）
  it('NH-5: every suggestion names the observation it follows from', async () => {
    const summary = await summarize(FIXTURES.noTextLayer);
    for (const line of summary.next) {
      expect(line).toMatch(/textExtractability|isTagged|pageCount|isEncrypted/);
    }
  });
});
