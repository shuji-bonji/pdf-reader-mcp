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

  // ========================================
  // include_bbox — 構造要素 → 描画座標（Issue #20 第 2 段階 / family G-A）
  //
  // 目的は UC-7 の「この段落に注釈を付ける」を family 内で閉じること。
  // 返す矩形は pdf-writer-mcp `add_annotation` がそのまま取る形
  // （PDF default user space・左下原点・pt・§7.9.5 正規化済み）でなければ
  // 受け渡しの途中で座標系を解釈し直すことになる。
  //
  // ここのテストは全て「間違えても *それらしい* 矩形が出る」ケースを踏む。
  // エラーにならない誤りは緑のテストを生き延びるので、値そのものを固定する。
  // ========================================
  describe('include_bbox: where an element is drawn (#20 stage 2)', () => {
    // BB-1: 既定では bbox を出さない（後方互換）
    it('BB-1: no boxes unless asked — the default output is unchanged', async () => {
      const result = await extractStructuredText(FIXTURES.elementBbox);

      expect(result.elements.every((e) => e.boxes === undefined)).toBe(true);
      expect(result.elements.every((e) => e.boxNote === undefined)).toBe(true);
      expect(result.bboxNotes).toBeUndefined();
    });

    // BB-2: テキストからの実測。ベースライン + フォントの ascent/descent。
    //       ベースライン y=300・12pt・Helvetica (ascent .718 / descent -.207)
    //       → y1 = 300 - 2.484、y2 = 300 + 8.616
    it('BB-2: a paragraph is measured from its text, ascent and descent included', async () => {
      const result = await extractStructuredText(FIXTURES.elementBbox, { includeBbox: true });
      const p = result.elements.find((e) => e.text === 'Measured paragraph');

      expect(p?.boxes).toHaveLength(1);
      const box = p?.boxes?.[0];
      expect(box?.page).toBe(1);
      expect(box?.basis).toBe('text-extent');
      expect(box?.rect.x1).toBeCloseTo(50, 1);
      expect(box?.rect.y1).toBeCloseTo(297.52, 1);
      expect(box?.rect.y2).toBeCloseTo(308.62, 1);
      // 正規化済み = add_annotation にそのまま渡せる
      expect(box?.rect.x2).toBeGreaterThan(box?.rect.x1 ?? 0);
      expect(box?.rect.y2).toBeGreaterThan(box?.rect.y1 ?? 0);
    });

    // BB-3: テキストを持たない Figure は /A の宣言 /BBox から座標を得る。
    //       実測では絶対に出せない（画像・ベクターは測っていない）ので、
    //       宣言を読まなければこの要素は「位置不明」で終わる。
    it('BB-3: a text-less Figure gets its rectangle from the declared /BBox (/A)', async () => {
      const result = await extractStructuredText(FIXTURES.elementBbox, { includeBbox: true });
      const figures = result.elements.filter((e) => e.role === 'Figure');

      expect(figures[0].boxes).toEqual([
        { page: 1, rect: { x1: 50, y1: 150, x2: 110, y2: 190 }, basis: 'layout-attribute-bbox' },
      ]);
    });

    // BB-4: 同じ属性を /C + /ClassMap 経由で宣言した場合（§14.7.6.2）。
    //       /A しか見ない実装はこれを取りこぼすが、エラーにはならない。
    it('BB-4: the same attribute reached through /C + /ClassMap is not lost', async () => {
      const result = await extractStructuredText(FIXTURES.elementBbox, { includeBbox: true });
      const figures = result.elements.filter((e) => e.role === 'Figure');

      expect(figures[1].boxes).toEqual([
        { page: 1, rect: { x1: 200, y1: 150, x2: 260, y2: 190 }, basis: 'layout-attribute-bbox' },
      ]);
    });

    // BB-5: 宣言が自分の本文を覆っていない = ファイルの自己矛盾。
    //       黙って実測で上書きせず、宣言をそのまま返した上で食い違いを報告する。
    //       （/A が配列 + リビジョン番号（§14.7.6.3）の形でもあることを兼ねる）
    it('BB-5: a declaration that does not cover its own text is reported, not reconciled', async () => {
      const result = await extractStructuredText(FIXTURES.elementBbox, { includeBbox: true });
      const p = result.elements.find((e) => e.text === 'Overclaimed');

      expect(p?.boxes?.[0].basis).toBe('layout-attribute-bbox');
      expect(p?.boxes?.[0].rect).toEqual({ x1: 0, y1: 0, x2: 10, y2: 10 });
      expect(p?.boxNote).toContain('does not cover the text measured inside the element');
    });

    // BB-5b: ページの外まで届く宣言 /BBox。
    //        `-32768 -32768 32767 32767`（int16 のセンチネル）は捏造ではなく、
    //        WTPDF 1.0 と Tagged PDF Best Practice Guide の**両方**の表紙 Figure に
    //        実在する（PDF32000_2008 では 545 件中 131 件がページ外へ出る）。
    //        無警告で返すと add_annotation に渡されて座標空間全体に描かれる。
    it('BB-5b: a declared /BBox reaching outside its page is flagged, not passed on quietly', async () => {
      const result = await extractStructuredText(FIXTURES.elementBbox, { includeBbox: true });
      const figures = result.elements.filter((e) => e.role === 'Figure');
      const sentinel = figures[2];

      // 宣言そのものは隠さず返す（reader は観測を返す）
      expect(sentinel.boxes?.[0].rect).toEqual({
        x1: -32768,
        y1: -32768,
        x2: 32767,
        y2: 32767,
      });
      expect(sentinel.boxNote).toContain('reaches outside page 1');
      expect(sentinel.boxNote).toContain('add_annotation');
      // 正しい宣言には警告を出さない（負の対照）
      expect(figures[0].boxNote).toBeUndefined();
      expect(figures[1].boxNote).toBeUndefined();
    });

    // BB-6: 45° 回転したテキスト。軸並行に x + width と足すと *それらしく*
    //       間違える（x2 が 317 付近になる）。run 自身の軸で組み立てて初めて
    //       実際の外接矩形になる。
    it('BB-6: rotated text is measured along the run axes, not the page axes', async () => {
      const result = await extractStructuredText(FIXTURES.elementBbox, { includeBbox: true });
      const p = result.elements.find((e) => e.text === 'Slanted');
      const rect = p?.boxes?.[0].rect;

      // 原点 (250,250) より左に張り出す — 軸並行の計算では絶対に出ない
      expect(rect?.x1).toBeLessThan(250);
      expect(rect?.x1).toBeCloseTo(239.85, 1);
      // 45° なので幅と高さはほぼ同じ
      const width = (rect?.x2 ?? 0) - (rect?.x1 ?? 0);
      const height = (rect?.y2 ?? 0) - (rect?.y1 ?? 0);
      expect(Math.abs(width - height)).toBeLessThan(0.5);
    });

    // BB-7: /MediaBox の原点が (0,0) でなく、かつ /Rotate 90 のページ。
    //       矩形は default user space なのでどちらにも影響されない。
    //       ここがずれると add_annotation にそのまま渡せなくなる。
    it('BB-7: an offset MediaBox and /Rotate 90 do not move the rectangle', async () => {
      const result = await extractStructuredText(FIXTURES.elementBbox, { includeBbox: true });
      const p = result.elements.find((e) => e.text === 'Offset page');
      const box = p?.boxes?.[0];

      expect(box?.page).toBe(2);
      // コンテンツストリームに書いた座標そのもの
      expect(box?.rect.x1).toBeCloseTo(150, 1);
      expect(box?.rect.y1).toBeCloseTo(497.52, 1);
    });

    // BB-8: ページを跨ぐ要素は「ページごとに 1 矩形」。
    //       1 つに潰すと、その要素が存在しないページに矩形を置くことになる。
    it('BB-8: a page-spanning element gets ONE rectangle PER PAGE', async () => {
      const result = await extractStructuredText(FIXTURES.structured, { includeBbox: true });
      const spanning = result.elements.find((e) => e.role === 'P' && e.pages.length > 1);

      expect(spanning?.boxes).toHaveLength(2);
      expect(spanning?.boxes?.map((b) => b.page)).toEqual([1, 2]);
      expect(spanning?.boxes?.every((b) => b.basis === 'text-extent')).toBe(true);
    });

    // BB-9: 測れないものは「測れない」と言う。
    //       structured.pdf の Figure は矩形を描くだけで文字が無く、/BBox も無い。
    //       ここで 0 幅の矩形やページ全体を返すのが最悪の挙動。
    it('BB-9: a Figure with no text and no /BBox gets no rectangle and says why', async () => {
      const result = await extractStructuredText(FIXTURES.structured, { includeBbox: true });
      const figure = result.elements.find((e) => e.role === 'Figure');

      expect(figure?.boxes).toBeUndefined();
      expect(figure?.boxNote).toContain('No text was measured');
      expect(figure?.boxNote).toContain('BBox attribute');
    });

    // BB-10: コンテナ（Document / Table / L）は子孫の矩形の合併を持つ。
    //        Table は 2 ページに跨るので 2 矩形。
    it('BB-10: a container covers its descendants, per page', async () => {
      const result = await extractStructuredText(FIXTURES.spanningTable, { includeBbox: true });
      const table = result.elements.find((e) => e.role === 'Table');

      expect(table?.boxes?.map((b) => b.page)).toEqual([1, 2]);
    });

    // BB-12: 「本文がある = 位置もある」。テキスト地図と矩形地図は同じ走査・
    //        同じ除外規則から作られているので、同一サーバ内で答えが割れては
    //        いけない（#15 → #18 で一度やった失敗）。
    //        実測: WTPDF 1.0 / Tagged-PDF Best Practice Guide / PDF32000_2008 /
    //        ISO 32000-2 の計 78,198 要素で違反 0。
    it('BB-12: an element that has text always has a rectangle', async () => {
      for (const fixture of [FIXTURES.structured, FIXTURES.spanningTable, FIXTURES.elementBbox]) {
        const result = await extractStructuredText(fixture, { includeBbox: true });
        const textButNoBox = result.elements.filter((e) => e.text && !e.boxes?.length);

        expect(textButNoBox.map((e) => `${e.role}:${e.text}`)).toEqual([]);
      }
    });

    // BB-11: 矩形の意味（座標系・実測か宣言か）を結果に添えて返す。
    //        add_annotation に渡す側が「何を持っているか」を知らずに渡すのを防ぐ。
    it('BB-11: the result states what the rectangles mean', async () => {
      const result = await extractStructuredText(FIXTURES.elementBbox, { includeBbox: true });

      expect(result.bboxNotes?.length).toBeGreaterThan(0);
      expect(result.bboxNotes?.join(' ')).toContain('default user space');
      expect(result.bboxNotes?.join(' ')).toContain('add_annotation');
    });
  });
});
