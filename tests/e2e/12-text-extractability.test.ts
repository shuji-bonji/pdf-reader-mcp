/**
 * 12 - Text extractability, three states (#21)
 *
 * TE-1〜TE-11 cover the acceptance list of the Issue. The point of the suite is
 * the PAIRS, not the individual answers: `empty.pdf` against `no-text-layer.pdf`
 * separates "there is no text" from "the text is pixels", and
 * `broken-cid-only.pdf` against `cid-font.pdf` separates total loss from partial
 * loss. A rule that got either half right by accident fails the other.
 */
import { describe, expect, it } from 'vitest';
import { searchText } from '../../src/services/pdfjs-service.js';
import { extractStructuredText } from '../../src/services/struct-tree-service.js';
import {
  foldExtractability,
  observeExtractability,
  summarizeExtractability,
} from '../../src/services/text-extractability-service.js';
import { FIXTURES } from './setup.js';

describe('12 - text extractability', () => {
  // TE-1: 画像だけのページは no_text_layer（空文字を返して終わらない）
  it('TE-1: no-text-layer.pdf reports no_text_layer on every page', async () => {
    const pages = await observeExtractability(FIXTURES.noTextLayer);
    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect(page.state).toBe('no_text_layer');
      expect(page.textShowingOperators).toBe(0);
      expect(page.imageOperators).toBeGreaterThan(0);
    }
  });

  // TE-2: 本当に空のページは extracted であり no_text_layer ではない
  it('TE-2: empty.pdf is extracted, not no_text_layer', async () => {
    const [page] = await observeExtractability(FIXTURES.empty);
    expect(page.state).toBe('extracted');
    expect(page.textShowingOperators).toBe(0);
    expect(page.imageOperators).toBe(0);
  });

  // TE-3: ToUnicode を持つ Identity-H は extracted（対照）
  it('TE-3: tounicode-cid.pdf is extracted', async () => {
    const [page] = await observeExtractability(FIXTURES.toUnicodeCid);
    expect(page.state).toBe('extracted');
    expect(page.fontsUsed).toBe(1);
    expect(page.unmappableFonts).toEqual([]);
  });

  // TE-4: ToUnicode の無い CID フォントだけのページは not_extractable
  it('TE-4: broken-cid-only.pdf is not_extractable, and names the font', async () => {
    const [page] = await observeExtractability(FIXTURES.brokenCidOnly);
    expect(page.state).toBe('not_extractable');
    expect(page.unmappableFonts).toHaveLength(1);
    expect(page.unmappableFonts[0].baseFont).toBe('BrokenCID-Identity-H');
    expect(page.unmappableFonts[0].reason).toContain('9.10.2');
  });

  // TE-5: 混在ページは「部分的な」not_extractable
  it('TE-5: cid-font.pdf is partially not_extractable', async () => {
    const [page] = await observeExtractability(FIXTURES.cidFont);
    expect(page.state).toBe('not_extractable');
    // Helvetica と Identity-H+ToUnicode 無しが同じページに居る。
    expect(page.unmappableFonts.length).toBeLessThan(page.fontsUsed);
    expect(page.unmappableFonts.map((f) => f.baseFont)).toContain('CCCCCC+NoToUnicode-Identity-H');
  });

  // TE-6: UniJIS-UCS2-H / Adobe-Japan1 は §9.10.2 の第3方式で読める
  it('TE-6: a predefined CJK CMap is not reported as unmappable', async () => {
    const [page] = await observeExtractability(FIXTURES.cidFont);
    const names = page.unmappableFonts.map((f) => f.baseFont);
    expect(names).not.toContain('KozMinPr6N-Regular-UniJIS-UCS2-H');
  });

  // TE-7: 通常の文書は 4 経路すべてで extracted のまま（偽陽性を出さない）
  it('TE-7: ordinary fixtures stay extracted', async () => {
    for (const fixture of [FIXTURES.simple, FIXTURES.tagged, FIXTURES.structured]) {
      const pages = await observeExtractability(fixture);
      expect(foldExtractability(pages)).toBe('extracted');
    }
  });

  // TE-8: 暗号化文書は not_observed（extracted に数えない）
  it('TE-8: an encrypted document is not_observed, never extracted', async () => {
    const [page] = await observeExtractability(FIXTURES.encryptedActualText);
    expect(page.state).toBe('not_observed');
    expect(page.reason).toContain('encrypted');
  });

  // TE-9: 文書全体の畳み込みは、読めないページを優先する
  it('TE-9: one unreadable page outranks many readable ones', () => {
    expect(
      foldExtractability([
        {
          page: 1,
          state: 'extracted',
          unmappableFonts: [],
          fontsUsed: 1,
          textShowingOperators: 5,
          imageOperators: 0,
          actualTextEntries: 0,
        },
        {
          page: 2,
          state: 'no_text_layer',
          unmappableFonts: [],
          fontsUsed: 0,
          textShowingOperators: 0,
          imageOperators: 1,
          actualTextEntries: 0,
        },
      ]),
    ).toBe('no_text_layer');
    expect(foldExtractability([])).toBe('not_observed');
  });

  // TE-10: search_text のヒット 0 件が「無い」と読めないようになっている
  it('TE-10: a zero-hit search over an unreadable page is flagged', async () => {
    const { matches } = await searchText(FIXTURES.brokenCidOnly, 'unreadable', 40);
    expect(matches).toHaveLength(0);
    const pages = await observeExtractability(FIXTURES.brokenCidOnly);
    expect(pages.every((p) => p.state === 'extracted')).toBe(false);
  });

  // TE-11: extract_structured_text も同じ状態を運ぶ（経路を 1 本も残さない）
  it('TE-11: the structured path carries the same state', async () => {
    const result = await extractStructuredText(FIXTURES.tagged, {});
    const pages = await observeExtractability(FIXTURES.tagged);
    expect(result.elements.length).toBeGreaterThan(0);
    expect(foldExtractability(pages)).toBe('extracted');
  });

  // TE-12: 表示用の要約は、全ページ extracted でも必ず 1 行出す
  it('TE-12: the banner is printed even when nothing is wrong', async () => {
    const pages = await observeExtractability(FIXTURES.simple);
    const lines = summarizeExtractability(pages);
    expect(lines[0]).toContain('Text extractability');
    expect(lines[0]).toContain('extracted 3');
  });
});
