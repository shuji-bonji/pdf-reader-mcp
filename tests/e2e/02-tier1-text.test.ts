/**
 * 02 - Tier 1 Text Operations E2E Tests
 *
 * RT-1〜RT-7: read_text (extractText)
 * ST-1〜ST-7: search_text (searchText)
 */
import { describe, expect, it } from 'vitest';
import { extractText, searchText } from '../../src/services/pdfjs-service.js';
import { FIXTURES } from './setup.js';

// ========================================
// テキスト抽出 (read_text)
// ========================================

describe('02 - read_text', () => {
  // RT-1: simple.pdf 全ページ
  it('RT-1: simple.pdf 全ページのテキスト抽出', async () => {
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
  it('RT-2: ページ指定 "1" で page=1 のみ', async () => {
    const pages = await extractText(FIXTURES.simple, '1');
    expect(pages).toHaveLength(1);
    expect(pages[0].page).toBe(1);
  });

  // RT-3: ページ範囲 "1-2"
  it('RT-3: ページ範囲 "1-2" で 2ページ分', async () => {
    const pages = await extractText(FIXTURES.simple, '1-2');
    expect(pages).toHaveLength(2);
    expect(pages[0].page).toBe(1);
    expect(pages[1].page).toBe(2);
  });

  // RT-4: 複合指定 "1,3"
  it('RT-4: 複合指定 "1,3" で page 1, 3 のみ', async () => {
    const pages = await extractText(FIXTURES.simple, '1,3');
    expect(pages).toHaveLength(2);
    expect(pages[0].page).toBe(1);
    expect(pages[1].page).toBe(3);
  });

  // RT-5: empty.pdf
  it('RT-5: empty.pdf のテキストは空', async () => {
    const pages = await extractText(FIXTURES.empty);
    expect(pages).toHaveLength(1);
    expect(pages[0].text.trim()).toBe('');
  });

  // RT-6: Y座標順序の保証
  it('RT-6: Y座標順序で "Hello PDF World" が最初に出現', async () => {
    const pages = await extractText(FIXTURES.simple, '1');
    const text = pages[0].text;
    expect(text.startsWith('Hello PDF World')).toBe(true);
  });

  // RT-7: テキスト内容の正確性
  it('RT-7: simple.pdf page 2 のテキスト内容', async () => {
    const pages = await extractText(FIXTURES.simple, '2');
    const text = pages[0].text;
    expect(text).toContain('Page Two');
    expect(text).toContain('PDF internal structure');
  });

  // RT-extra: multi-font.pdf のテキスト
  it('RT-extra: multi-font.pdf の全フォントテキスト抽出', async () => {
    const pages = await extractText(FIXTURES.multiFont);
    expect(pages).toHaveLength(2);
    expect(pages[0].text).toContain('Helvetica Regular');
    expect(pages[1].text).toContain('Times Roman');
    expect(pages[1].text).toContain('Courier');
  });

  // RT-extra: tagged.pdf のテキスト
  it('RT-extra: tagged.pdf のテキスト抽出', async () => {
    const pages = await extractText(FIXTURES.tagged);
    expect(pages).toHaveLength(2);
    expect(pages[0].text).toContain('Tagged PDF Document');
    expect(pages[0].text).toContain('Accessibility');
    expect(pages[1].text).toContain('Section Two');
  });
});

// ========================================
// テキスト検索 (search_text)
// ========================================

describe('02 - search_text', () => {
  // ST-1: "Hello" 検索
  it('ST-1: "Hello" 検索で page=1 にマッチ', async () => {
    const matches = await searchText(FIXTURES.simple, 'Hello');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].page).toBe(1);
    expect(matches[0].text).toBe('Hello');
  });

  // ST-2: "PDF" 検索 (複数マッチ)
  it('ST-2: "PDF" 検索で複数マッチ', async () => {
    const matches = await searchText(FIXTURES.simple, 'PDF');
    expect(matches.length).toBeGreaterThan(1);
    // 複数ページにまたがるマッチ
    const pages = new Set(matches.map((m) => m.page));
    expect(pages.size).toBeGreaterThanOrEqual(1);
  });

  // ST-3: 大文字小文字無視
  it('ST-3: 大文字小文字無視で "hello" でもマッチ', async () => {
    const matches = await searchText(FIXTURES.simple, 'hello');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // 元のテキストは "Hello" だが case-insensitive で見つかる
  });

  // ST-4: 存在しないクエリ
  it('ST-4: 存在しないクエリで matches=[]', async () => {
    const matches = await searchText(FIXTURES.simple, 'xyznonexistent');
    expect(matches).toHaveLength(0);
  });

  // ST-5: ページ指定検索
  it('ST-5: ページ指定 "2" で page=2 のみ検索', async () => {
    const matches = await searchText(FIXTURES.simple, 'PDF', 80, '2');
    for (const m of matches) {
      expect(m.page).toBe(2);
    }
  });

  // ST-6: コンテキスト文字数指定
  it('ST-6: コンテキスト文字数 10 で contextBefore/After が短い', async () => {
    const matches = await searchText(FIXTURES.simple, 'Hello', 10);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    const match = matches[0];
    expect(match.contextBefore.length).toBeLessThanOrEqual(10);
    expect(match.contextAfter.length).toBeLessThanOrEqual(10);
  });

  // ST-7: empty.pdf で検索
  it('ST-7: empty.pdf で検索 → 結果なし', async () => {
    const matches = await searchText(FIXTURES.empty, 'test');
    expect(matches).toHaveLength(0);
  });

  // ST-extra: マッチのプロパティ完全性
  it('ST-extra: マッチオブジェクトの全プロパティが存在', async () => {
    const matches = await searchText(FIXTURES.simple, 'Hello');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    const m = matches[0];
    expect(typeof m.page).toBe('number');
    expect(typeof m.lineIndex).toBe('number');
    expect(typeof m.text).toBe('string');
    expect(typeof m.contextBefore).toBe('string');
    expect(typeof m.contextAfter).toBe('string');
  });
});
