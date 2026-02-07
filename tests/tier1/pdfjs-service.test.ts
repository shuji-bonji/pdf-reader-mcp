/**
 * Tests for pdfjs-service.ts
 */

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  countImages,
  extractText,
  getMetadata,
  loadDocument,
  searchText,
} from '../../src/services/pdfjs-service.js';

const SIMPLE_PDF = resolve(import.meta.dirname, '../fixtures/simple.pdf');
const EMPTY_PDF = resolve(import.meta.dirname, '../fixtures/empty.pdf');

describe('loadDocument', () => {
  it('should load a valid PDF', async () => {
    const doc = await loadDocument(SIMPLE_PDF);
    expect(doc.numPages).toBe(3);
    await doc.destroy();
  });
});

describe('getMetadata', () => {
  it('should return metadata with correct fields', async () => {
    const meta = await getMetadata(SIMPLE_PDF);
    expect(meta.pageCount).toBe(3);
    expect(meta.title).toBe('Test PDF Document');
    expect(meta.author).toBe('pdf-reader-mcp');
    expect(meta.subject).toBe('Test fixture');
    expect(meta.creator).toBe('pdf-lib');
    expect(meta.producer).toBe('pdf-reader-mcp test suite');
    expect(meta.fileSize).toBeGreaterThan(0);
  });

  it('should report empty PDF metadata', async () => {
    const meta = await getMetadata(EMPTY_PDF);
    expect(meta.pageCount).toBe(1);
    expect(meta.title).toBeNull();
    expect(meta.author).toBeNull();
  });
});

describe('extractText', () => {
  it('should extract text from all pages', async () => {
    const pages = await extractText(SIMPLE_PDF);
    expect(pages).toHaveLength(3);
    expect(pages[0].page).toBe(1);
    expect(pages[0].text).toContain('Hello PDF World');
  });

  it('should extract text from specific pages', async () => {
    const pages = await extractText(SIMPLE_PDF, '2');
    expect(pages).toHaveLength(1);
    expect(pages[0].page).toBe(2);
    expect(pages[0].text).toContain('Page Two');
  });

  it('should extract text from a page range', async () => {
    const pages = await extractText(SIMPLE_PDF, '1-2');
    expect(pages).toHaveLength(2);
    expect(pages[0].text).toContain('Hello PDF World');
    expect(pages[1].text).toContain('Page Two');
  });

  it('should return empty text for blank pages', async () => {
    const pages = await extractText(EMPTY_PDF);
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toBe('');
  });
});

describe('searchText', () => {
  it('should find case-insensitive matches', async () => {
    const matches = await searchText(SIMPLE_PDF, 'pdf');
    expect(matches.length).toBeGreaterThan(0);
    // "PDF" appears in "Hello PDF World" and other places
    const page1Matches = matches.filter((m) => m.page === 1);
    expect(page1Matches.length).toBeGreaterThan(0);
  });

  it('should return no matches for non-existent text', async () => {
    const matches = await searchText(SIMPLE_PDF, 'xyznonexistent');
    expect(matches).toHaveLength(0);
  });

  it('should search within specific pages', async () => {
    const matches = await searchText(SIMPLE_PDF, 'Page Two', 80, '2');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.page === 2)).toBe(true);
  });

  it('should include context around matches', async () => {
    const matches = await searchText(SIMPLE_PDF, 'digital signatures', 40);
    expect(matches.length).toBeGreaterThan(0);
    // Context should be present (non-empty around the match)
    const match = matches[0];
    expect(match.text.toLowerCase()).toContain('digital signatures');
  });
});

describe('countImages', () => {
  it('should count zero images in text-only PDF', async () => {
    const count = await countImages(SIMPLE_PDF);
    expect(count).toBe(0);
  });
});
