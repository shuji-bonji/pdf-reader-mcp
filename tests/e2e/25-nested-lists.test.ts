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

// ─── #54: the item's pages / boxes point at what its text points at ──────────

type Box = { page: number; rect: { x1: number; y1: number; x2: number; y2: number } };
type Measured = { role: string; text: string | null; pages: number[]; boxes?: Box[] };

/** The elements of a fixture with boxes, as `role` + `text` + `pages` + `boxes`. */
async function measured(file: string): Promise<Measured[]> {
  const result = await extractStructuredText(file, { includeBbox: true });
  return (result.elements ?? []).map((e) => ({
    role: e.role,
    text: e.text,
    pages: e.pages,
    ...(e.boxes ? { boxes: e.boxes as Box[] } : {}),
  }));
}

/** The element right after the LI whose text is `text` (the nested L, in these fixtures). */
function itemAndNext(rows: Measured[], text: string): [Measured, Measured] {
  const i = rows.findIndex((r) => r.role === 'LI' && r.text === text);
  expect(i).toBeGreaterThanOrEqual(0);
  return [rows[i], rows[i + 1]];
}

describe('SPEC-READER-EXTRACT-STRUCTURED-TEXT-004 項目の pages と boxes は、入れ子のリストを含まない', () => {
  it('SPEC-READER-EXTRACT-STRUCTURED-TEXT-004 LBody の中の入れ子のリストを持つ項目の boxes は、入れ子の項目を覆わない', async () => {
    const [parent, nested] = itemAndNext(await measured(FIXTURES.nestedLists), 'Parent one');
    expect(nested.role).toBe('L');
    expect(parent.boxes).toHaveLength(1);
    expect(nested.boxes).toHaveLength(1);
    const p = (parent.boxes as Box[])[0].rect;
    const n = (nested.boxes as Box[])[0].rect;
    // 項目の箱は入れ子のリストより上にあり、重ならない
    expect(p.y1).toBeGreaterThan(n.y2);
    // 記号（x = 60）は項目の範囲に入ったまま
    expect(p.x1).toBeLessThanOrEqual(60.5);
  });

  it('SPEC-READER-EXTRACT-STRUCTURED-TEXT-004 入れ子のリストの置き場所が違っても、項目の範囲の高さは同じ', async () => {
    const rows = await measured(FIXTURES.nestedLists);
    const [a] = itemAndNext(rows, 'Parent one');
    const [b, bNested] = itemAndNext(rows, 'Alpha');
    expect(bNested.role).toBe('L');
    const ra = (a.boxes as Box[])[0].rect;
    const rb = (b.boxes as Box[])[0].rect;
    expect(ra.y2 - ra.y1).toBeCloseTo(rb.y2 - rb.y1, 3);
    expect(rb.y1).toBeGreaterThan((bNested.boxes as Box[])[0].rect.y2);
  });

  it('SPEC-READER-EXTRACT-STRUCTURED-TEXT-004 入れ子の項目が次のページにあっても、親の項目の pages に入らない', async () => {
    const [parent, nested] = itemAndNext(
      await measured(FIXTURES.nestedListAcrossPages),
      'Parent one',
    );
    expect(parent.pages).toEqual([1]);
    expect(parent.boxes?.map((b) => b.page)).toEqual([1]);
    expect(nested.role).toBe('L');
    expect(nested.pages).toEqual([1, 2]);
    expect(nested.boxes?.map((b) => b.page)).toEqual([1, 2]);
  });

  it('SPEC-READER-EXTRACT-STRUCTURED-TEXT-004 入れ子の L の範囲は下位項目を含む', async () => {
    const rows = await measured(FIXTURES.nestedLists);
    const [, nested] = itemAndNext(rows, 'Parent one');
    const n = (nested.boxes as Box[])[0].rect;
    for (const text of ['Nested one', 'Nested two']) {
      const r = (
        (rows.find((x) => x.role === 'LI' && x.text === text) as Measured).boxes as Box[]
      )[0].rect;
      expect(n.y1).toBeLessThanOrEqual(r.y1);
      expect(n.y2).toBeGreaterThanOrEqual(r.y2);
    }
  });
});
