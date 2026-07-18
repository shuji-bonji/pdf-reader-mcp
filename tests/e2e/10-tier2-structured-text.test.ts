/**
 * 10 - extract_structured_text E2E Tests (M-8)
 *
 * ST-1〜ST-4: ページ跨ぎ要素の統合（本ツールの中心的な主張）
 * ST-5〜ST-8: ActualText / Alt / Lbl / Table
 * ST-9〜ST-12: タグ無し・絞り込み・順序
 *
 * 仕様: Document-Note/mcps/PDFfamily/specs/08-structured-text-and-reflow.md v0.2
 * レビュー: docs/m8-spec-review-2026-07-18.md
 */
import { describe, expect, it } from 'vitest';
import { extractStructuredText } from '../../src/services/struct-tree-service.js';
import { FIXTURES } from './setup.js';

/** 指定 role の最初の要素を取る。 */
async function elementsOf(path: string, options?: { pages?: string; roles?: string[] }) {
  const result = await extractStructuredText(path, options ?? {});
  return result.elements;
}

// ========================================
// ページ跨ぎ要素の統合
//
// ここが M-8 の存在理由。ISO 32000-2 §14.8.2.5 は logical content order を
// 「**document の**構造階層の深さ優先走査」と定義し、NOTE 2 は
// 「A logical object can extend over more than one PDF page」と明示する。
//
// pdfjs の `page.getStructTree()` をページ順に併合する方式（extract_tables /
// inspect_tags が採る方式）は、ページを跨ぐ要素を **2 つに分裂**させる。
// pdfjs のノードは要素の識別子を持たないので、併合後に復元する手段が無い。
// これらのテストはその分裂が起きていないことを固定する。
// ========================================

describe('10 - extract_structured_text', () => {
  describe('page-spanning elements stay whole (the reason this tool exists)', () => {
    // ST-1: ページを跨ぐ段落が 1 つの要素として返る
    it('ST-1: a paragraph split across a page break is ONE element', async () => {
      const elements = await elementsOf(FIXTURES.structured);
      const spanning = elements.filter((e) => e.role === 'P' && e.pages.length > 1);

      expect(spanning).toHaveLength(1);
      expect(spanning[0].pages).toEqual([1, 2]);
    });

    // ST-2: その本文が両ページ分つながっている（分裂していれば片方しか無い）
    it('ST-2: the spanning paragraph carries the text from BOTH pages', async () => {
      const elements = await elementsOf(FIXTURES.structured);
      const spanning = elements.find((e) => e.role === 'P' && e.pages.length > 1);

      expect(spanning?.text).toBe('This paragraph begins on page one and continues on page two.');
    });

    // ST-3: ページ境界に空白が入る（英語では改行 = 語区切り）
    //       ページ先頭の marked content には pdfjs が EOL を出さないため、
    //       ここを手当てしないと "page oneand continues" になる
    it('ST-3: the page boundary becomes a space, not a missing separator', async () => {
      const elements = await elementsOf(FIXTURES.structured);
      const spanning = elements.find((e) => e.role === 'P' && e.pages.length > 1);

      expect(spanning?.text).toContain('page one and continues');
      expect(spanning?.text).not.toContain('oneand');
    });

    // ST-4: ページを跨ぐリストが 1 つの L として返り、LI を 2 つ持つ
    //       併合方式だと L が 2 つ・各 LI 1 個になる
    it('ST-4: a list split across a page break is ONE list with both items', async () => {
      const elements = await elementsOf(FIXTURES.structured);
      const lists = elements.filter((e) => e.role === 'L');
      const items = elements.filter((e) => e.role === 'LI');

      expect(lists).toHaveLength(1);
      expect(lists[0].pages).toEqual([1, 2]);
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.text)).toEqual(['First item', 'Second item']);
      expect(items.map((i) => i.pages)).toEqual([[1], [2]]);
    });
  });

  // ========================================
  // ActualText / Alt — 条文が明確に区別している（§14.9.4 / §14.9.3）
  // ========================================

  describe('ActualText and Alt are different things', () => {
    // ST-5: ActualText はグリフを置換する（§14.9.4「a replacement, not a description」）
    it('ST-5: ActualText replaces the glyphs', async () => {
      const elements = await elementsOf(FIXTURES.structured);
      // フィクスチャのグリフは "Dif`cult"（合字の代用）、ActualText は "Difficult"
      const withActual = elements.find((e) => e.text === 'Difficult');

      expect(withActual).toBeDefined();
      expect(elements.some((e) => e.text?.includes('Dif`cult'))).toBe(false);
    });

    // ST-6: Alt は text に混入しない（§14.9.3 = 内容ではなく内容の「説明」）
    //       混入すると、リフロー後の本文に説明文が流し込まれる
    it('ST-6: Alt is reported separately and never as text', async () => {
      const elements = await elementsOf(FIXTURES.structured);
      const figure = elements.find((e) => e.role === 'Figure');

      expect(figure).toBeDefined();
      expect(figure?.alt).toBe('A bar chart of sales');
      expect(figure?.text).toBeNull();
      // どの要素の text にも Alt の文字列が現れないこと
      expect(elements.some((e) => e.text?.includes('A bar chart'))).toBe(false);
    });
  });

  // ========================================
  // Lbl / Table
  // ========================================

  describe('list labels and tables', () => {
    // ST-7: Lbl は label に分離される（text に混ぜると "- • 項目" になる）
    it('ST-7: Lbl goes to label, not into text', async () => {
      const elements = await elementsOf(FIXTURES.structured);
      const items = elements.filter((e) => e.role === 'LI');

      for (const item of items) {
        expect(item.label).toBe('*');
        expect(item.text).not.toContain('*');
      }
      // Lbl 自体は独立した要素としては現れない
      expect(elements.some((e) => e.role === 'Lbl')).toBe(false);
    });

    // ST-8: Table は rows を持つ（2 次元は depth で表現できない）
    it('ST-8: Table carries rows, mirroring extract_tables', async () => {
      const elements = await elementsOf(FIXTURES.structured);
      const table = elements.find((e) => e.role === 'Table');

      expect(table?.rows).toEqual([
        [
          { text: 'Item', isHeader: true },
          { text: 'Amount', isHeader: true },
        ],
        [
          { text: 'Sales', isHeader: false },
          { text: '100', isHeader: false },
        ],
      ]);
      // 行やセルはフラット側に重複して現れない
      expect(elements.some((e) => ['TR', 'TH', 'TD'].includes(e.role))).toBe(false);
    });
  });

  // ========================================
  // 順序・階層・絞り込み・タグ無し
  // ========================================

  describe('order, depth, filters and untagged documents', () => {
    // ST-9: logical content order = 構造木の深さ優先（§14.8.2.5）
    it('ST-9: elements come back in depth-first logical content order', async () => {
      const elements = await elementsOf(FIXTURES.structured);

      expect(elements.map((e) => e.role)).toEqual([
        'Document',
        'H1',
        'P', // ページを跨ぐ段落
        'Table',
        'L',
        'LI',
        'LI',
        'P', // ActualText
        'Figure',
        'P', // 結び
      ]);
    });

    // ST-10: depth で木が復元できる（フラットにしても情報が落ちていない）
    it('ST-10: depth encodes the tree', async () => {
      const elements = await elementsOf(FIXTURES.structured);

      expect(elements[0]).toMatchObject({ role: 'Document', depth: 0 });
      expect(elements.filter((e) => e.role === 'LI').every((e) => e.depth === 2)).toBe(true);
      expect(elements.find((e) => e.role === 'L')?.depth).toBe(1);
    });

    // ST-11: roles で絞れる（目次の抽出）
    it('ST-11: roles filters the output', async () => {
      const elements = await elementsOf(FIXTURES.structured, { roles: ['H1'] });

      expect(elements).toHaveLength(1);
      expect(elements[0].text).toBe('Quarterly Report');
    });

    // ST-12: pages で絞っても、範囲にかかる要素は丸ごと返る
    //        （分裂させないことが本ツールの主眼なので、途中で切らない）
    it('ST-12: pages keeps a spanning element whole', async () => {
      const elements = await elementsOf(FIXTURES.structured, { pages: '2' });
      const spanning = elements.find((e) => e.role === 'P' && e.pages.length > 1);

      expect(spanning?.pages).toEqual([1, 2]);
      expect(spanning?.text).toContain('begins on page one');
      // 1 ページ目だけの要素は落ちる
      expect(elements.some((e) => e.role === 'H1')).toBe(false);
    });

    // ST-13: タグ無し文書は推測せず「できない」と返す（§14.8.2.5 NOTE 1）
    it('ST-13: an untagged document returns isTagged: false and no guesses', async () => {
      const result = await extractStructuredText(FIXTURES.simple);

      expect(result.isTagged).toBe(false);
      expect(result.elements).toEqual([]);
      expect(result.note).toContain('not tagged');
      expect(result.note).toContain('ensure_tagged');
    });

    // ST-14: 構造木はあるが marked content が無い文書も「できない」側
    //        tagged.pdf がまさにそれ（StructElem はあるが MCID が無い）
    it('ST-14: a structure tree with no marked content yields no text, not fake text', async () => {
      const result = await extractStructuredText(FIXTURES.tagged);

      // MarkInfo/Marked は true なので isTagged は立つ
      expect(result.isTagged).toBe(true);
      // しかし本文は取れない — 捏造せず null を返す
      expect(result.elements.every((e) => e.text === null)).toBe(true);
    });

    // ST-15: ドキュメントの言語を返す
    it('ST-15: reports the document language', async () => {
      const result = await extractStructuredText(FIXTURES.structured);
      expect(result.lang).toBe('en-US');
    });
  });
});
