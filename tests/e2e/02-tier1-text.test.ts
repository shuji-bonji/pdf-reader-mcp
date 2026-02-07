/**
 * 02 - Tier 1 Text Operations E2E Tests
 *
 * RT-1〜RT-7: read_text (extractText)
 * ST-1〜ST-7: search_text (searchText)
 */
import { describe, expect, it } from 'vitest';
import { extractText, searchText } from '../../src/services/pdfjs-service.js';
import { EXPECTED_TEXT, SEARCH_QUERIES } from './constants.js';
import { FIXTURES } from './setup.js';

// ========================================
// Text extraction (read_text)
// ========================================

describe('02 - read_text', () => {
  // RT-1: simple.pdf 全ページ
  it('RT-1: simple.pdf extracts all 3 pages', async () => {
    const pages = await extractText(FIXTURES.simple);
    expect(pages).toHaveLength(3);
    expect(pages[0].page).toBe(1);
    expect(pages[1].page).toBe(2);
    expect(pages[2].page).toBe(3);
    // 各ページにテキストが存在
    for (const p of pages) {
      expect(p.text.length).toBeGreaterThan(0);
    }
  });

  // RT-2: ページ指定 "1"
  it('RT-2: page "1" returns only page 1', async () => {
    const pages = await extractText(FIXTURES.simple, '1');
    expect(pages).toHaveLength(1);
    expect(pages[0].page).toBe(1);
  });

  // RT-3: ページ範囲 "1-2"
  it('RT-3: range "1-2" returns 2 pages', async () => {
    const pages = await extractText(FIXTURES.simple, '1-2');
    expect(pages).toHaveLength(2);
    expect(pages[0].page).toBe(1);
    expect(pages[1].page).toBe(2);
  });

  // RT-4: 複合指定 "1,3"
  it('RT-4: comma "1,3" returns pages 1 and 3', async () => {
    const pages = await extractText(FIXTURES.simple, '1,3');
    expect(pages).toHaveLength(2);
    expect(pages[0].page).toBe(1);
    expect(pages[1].page).toBe(3);
  });

  // RT-5: empty.pdf
  it('RT-5: empty.pdf has no text', async () => {
    const pages = await extractText(FIXTURES.empty);
    expect(pages).toHaveLength(1);
    expect(pages[0].text.trim()).toBe('');
  });

  // RT-6: Y座標順序の保証
  it('RT-6: text starts with "Hello PDF World" (Y-coordinate order)', async () => {
    const pages = await extractText(FIXTURES.simple, '1');
    expect(pages[0].text.startsWith(EXPECTED_TEXT.simplePage1Start)).toBe(true);
  });

  // RT-7: テキスト内容の正確性
  it('RT-7: simple.pdf page 2 contains expected keywords', async () => {
    const pages = await extractText(FIXTURES.simple, '2');
    for (const keyword of EXPECTED_TEXT.simplePage2Keywords) {
      expect(pages[0].text).toContain(keyword);
    }
  });

  // RT-extra: multi-font.pdf のテキスト
  it('RT-extra: multi-font.pdf extracts all font texts', async () => {
    const pages = await extractText(FIXTURES.multiFont);
    expect(pages).toHaveLength(2);
    for (const kw of EXPECTED_TEXT.multiFontPage1Keywords) {
      expect(pages[0].text).toContain(kw);
    }
    for (const kw of EXPECTED_TEXT.multiFontPage2Keywords) {
      expect(pages[1].text).toContain(kw);
    }
  });

  // RT-extra: tagged.pdf のテキスト
  it('RT-extra: tagged.pdf text extraction', async () => {
    const pages = await extractText(FIXTURES.tagged);
    expect(pages).toHaveLength(2);
    for (const kw of EXPECTED_TEXT.taggedPage1Keywords) {
      expect(pages[0].text).toContain(kw);
    }
    for (const kw of EXPECTED_TEXT.taggedPage2Keywords) {
      expect(pages[1].text).toContain(kw);
    }
  });
});

// ========================================
// Text search (search_text)
// ========================================

describe('02 - search_text', () => {
  // ST-1: "Hello" 検索
  it('ST-1: "Hello" matches on page 1', async () => {
    const matches = await searchText(FIXTURES.simple, SEARCH_QUERIES.hello);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].page).toBe(1);
    expect(matches[0].text).toBe(SEARCH_QUERIES.hello);
  });

  // ST-2: "PDF" 検索 (複数マッチ)
  it('ST-2: "PDF" returns multiple matches', async () => {
    const matches = await searchText(FIXTURES.simple, SEARCH_QUERIES.pdf);
    expect(matches.length).toBeGreaterThan(1);
    const pages = new Set(matches.map((m) => m.page));
    expect(pages.size).toBeGreaterThanOrEqual(1);
  });

  // ST-3: 大文字小文字無視
  it('ST-3: case-insensitive search for "hello"', async () => {
    const matches = await searchText(FIXTURES.simple, SEARCH_QUERIES.helloLower);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  // ST-4: 存在しないクエリ
  it('ST-4: non-existent query returns empty', async () => {
    const matches = await searchText(FIXTURES.simple, SEARCH_QUERIES.nonExistent);
    expect(matches).toHaveLength(0);
  });

  // ST-5: ページ指定検索
  it('ST-5: page filter "2" only returns page 2 matches', async () => {
    const matches = await searchText(FIXTURES.simple, SEARCH_QUERIES.pdf, 80, '2');
    for (const m of matches) {
      expect(m.page).toBe(2);
    }
  });

  // ST-6: コンテキスト文字数指定
  it('ST-6: context_chars=10 limits context length', async () => {
    const contextChars = 10;
    const matches = await searchText(FIXTURES.simple, SEARCH_QUERIES.hello, contextChars);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].contextBefore.length).toBeLessThanOrEqual(contextChars);
    expect(matches[0].contextAfter.length).toBeLessThanOrEqual(contextChars);
  });

  // ST-7: empty.pdf で検索
  it('ST-7: empty.pdf search returns no results', async () => {
    const matches = await searchText(FIXTURES.empty, SEARCH_QUERIES.test);
    expect(matches).toHaveLength(0);
  });

  // ST-extra: マッチのプロパティ完全性
  it('ST-extra: match object has all required properties', async () => {
    const matches = await searchText(FIXTURES.simple, SEARCH_QUERIES.hello);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    const m = matches[0];
    expect(typeof m.page).toBe('number');
    expect(typeof m.lineIndex).toBe('number');
    expect(typeof m.text).toBe('string');
    expect(typeof m.contextBefore).toBe('string');
    expect(typeof m.contextAfter).toBe('string');
  });
});
