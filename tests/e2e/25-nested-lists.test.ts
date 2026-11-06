/**
 * 25 - extract_structured_text: nested lists (#52)
 *
 * 0.21.0 まで、`LBody` の中の入れ子のリストは親の `LI` の `text` に畳まれていた
 * （入れ子の `LI` が要素として出ず、入れ子の `Lbl` も親の `text` に入る）。
 * pdf-writer-mcp 0.25.0 はこの形でリストを書くので、writer の出力を読むと必ず当たる。
 *
 * 親の `L` の直接の子に置く形（ISO 32000-2 H.8.3）は前から辿れていたが、検体が無かった。
 * 両方の形を 1 つのフィクスチャ（nested-lists.pdf）に置く。
 */
import { describe, expect, it } from 'vitest';
import { extractStructuredText } from '../../src/services/struct-tree-service.js';
import { formatStructuredTextMarkdown } from '../../src/utils/formatter.js';
import { FIXTURES } from './setup.js';

type Row = { role: string; depth: number; text: string | null; label?: string };

/** `H1` の見出しから次の `H1` までの、リストの要素だけ */
async function listUnder(heading: string): Promise<Row[]> {
  const result = await extractStructuredText(FIXTURES.nestedLists, {});
  const elements = result.elements ?? [];
  const start = elements.findIndex((e) => e.role === 'H1' && e.text === heading);
  const rows: Row[] = [];
  for (const e of elements.slice(start + 1)) {
    if (e.role === 'H1') break;
    rows.push({
      role: e.role,
      depth: e.depth,
      text: e.text,
      ...(e.label ? { label: e.label } : {}),
    });
  }
  return rows;
}

describe('SPEC-READER-EXTRACT-STRUCTURED-TEXT-003 入れ子のリストは親の項目の text に混ぜず、要素として出す', () => {
  it('SPEC-READER-EXTRACT-STRUCTURED-TEXT-003 LBody の中の入れ子のリストを要素として出す', async () => {
    const rows = await listUnder('Form A');
    const d = rows[0].depth; // 親の L
    expect(rows).toEqual([
      { role: 'L', depth: d, text: null },
      { role: 'LI', depth: d + 1, text: 'Parent one', label: '•' },
      { role: 'L', depth: d + 2, text: null },
      { role: 'LI', depth: d + 3, text: 'Nested one', label: '•' },
      { role: 'LI', depth: d + 3, text: 'Nested two', label: '•' },
      { role: 'LI', depth: d + 1, text: 'Parent two', label: '•' },
    ]);
  });

  it('SPEC-READER-EXTRACT-STRUCTURED-TEXT-003 親の L の直接の子の入れ子のリストを要素として出す', async () => {
    const rows = await listUnder('Form B');
    const d = rows[0].depth;
    expect(rows).toEqual([
      { role: 'L', depth: d, text: null },
      { role: 'LI', depth: d + 1, text: 'Alpha', label: '•' },
      { role: 'L', depth: d + 1, text: null },
      { role: 'LI', depth: d + 2, text: 'Alpha one', label: '•' },
      { role: 'LI', depth: d + 2, text: 'Alpha two', label: '•' },
      { role: 'LI', depth: d + 1, text: 'Beta', label: '•' },
    ]);
    expect(rows.filter((r) => r.text?.includes('•'))).toEqual([]);
  });

  it('SPEC-READER-EXTRACT-STRUCTURED-TEXT-003 入れ子の無いリストは変わらない', async () => {
    const result = await extractStructuredText(FIXTURES.structured, {});
    const list = (result.elements ?? []).filter((e) => e.role === 'L' || e.role === 'LI');
    expect(list.map((e) => [e.role, e.depth, e.text, e.label ?? null])).toEqual([
      ['L', 1, null, null],
      ['LI', 2, 'First item', '*'],
      ['LI', 2, 'Second item', '*'],
    ]);
  });

  it('SPEC-READER-EXTRACT-STRUCTURED-TEXT-003 Markdown でも入れ子の項目を親より深く字下げする', async () => {
    const md = formatStructuredTextMarkdown(await extractStructuredText(FIXTURES.nestedLists, {}));
    const lines = md.split('\n');
    const parent = lines.find((l) => l.includes('— Parent one'));
    const nested = lines.find((l) => l.includes('— Nested one'));
    const indentOf = (l?: string) => (l ?? '').length - (l ?? '').trimStart().length;
    expect(parent).toBeDefined();
    expect(nested).toBeDefined();
    expect(parent).not.toContain('Nested');
    expect(indentOf(nested)).toBeGreaterThan(indentOf(parent));
  });
});
