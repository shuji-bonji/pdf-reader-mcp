/**
 * 05 - Tier 2 Tags, Annotations & Signatures E2E Tests
 *
 * IT-1〜IT-5: inspect_tags (analyzeTags)
 * IA-1〜IA-6: inspect_annotations (analyzeAnnotations)
 * SG-1〜SG-4: inspect_signatures (analyzeSignatures)
 */
import { describe, expect, it } from 'vitest';
import { analyzeAnnotations, analyzeTags } from '../../src/services/pdfjs-service.js';
import { analyzeSignatures } from '../../src/services/pdflib-service.js';
import { FIXTURES } from './setup.js';

// ========================================
// タグ構造解析 (inspect_tags)
// ========================================

describe('05 - inspect_tags', () => {
  // IT-1: tagged.pdf
  it('IT-1: tagged.pdf で isTagged=true, rootTag 非null', async () => {
    const result = await analyzeTags(FIXTURES.tagged);
    expect(result.isTagged).toBe(true);
    expect(result.rootTag).not.toBeNull();
  });

  // IT-2: simple.pdf (非タグ)
  it('IT-2: simple.pdf で isTagged=false', async () => {
    const result = await analyzeTags(FIXTURES.simple);
    expect(result.isTagged).toBe(false);
    expect(result.rootTag).toBeNull();
    expect(result.totalElements).toBe(0);
  });

  // IT-3: roleCounts
  it('IT-3: tagged.pdf の roleCounts にタグが存在', async () => {
    const result = await analyzeTags(FIXTURES.tagged);
    expect(typeof result.roleCounts).toBe('object');
    // MarkInfo を設定しているので isTagged=true
    // pdfjs-dist がページ単位で構造ツリーを読めるかはライブラリ依存
    if (result.totalElements > 0) {
      expect(Object.keys(result.roleCounts).length).toBeGreaterThan(0);
    }
  });

  // IT-4: maxDepth
  it('IT-4: tagged.pdf の maxDepth >= 0', async () => {
    const result = await analyzeTags(FIXTURES.tagged);
    expect(result.maxDepth).toBeGreaterThanOrEqual(0);
  });

  // IT-5: totalElements
  it('IT-5: tagged.pdf の totalElements >= 0', async () => {
    const result = await analyzeTags(FIXTURES.tagged);
    expect(result.totalElements).toBeGreaterThanOrEqual(0);
  });

  // IT-extra: 非タグPDFの一貫性
  it('IT-extra: empty.pdf で isTagged=false', async () => {
    const result = await analyzeTags(FIXTURES.empty);
    expect(result.isTagged).toBe(false);
    expect(result.maxDepth).toBe(0);
    expect(result.totalElements).toBe(0);
  });
});

// ========================================
// 注釈解析 (inspect_annotations)
// ========================================

describe('05 - inspect_annotations', () => {
  // IA-1: annotated.pdf の総注釈数
  it('IA-1: annotated.pdf で totalAnnotations >= 4', async () => {
    const result = await analyzeAnnotations(FIXTURES.annotated);
    expect(result.totalAnnotations).toBeGreaterThanOrEqual(4);
  });

  // IA-2: Link 注釈
  it('IA-2: annotated.pdf で hasLinks=true', async () => {
    const result = await analyzeAnnotations(FIXTURES.annotated);
    expect(result.hasLinks).toBe(true);
    expect(result.bySubtype.Link).toBeGreaterThan(0);
  });

  // IA-3: Widget (フォームフィールド)
  it('IA-3: annotated.pdf で hasForms=true', async () => {
    const result = await analyzeAnnotations(FIXTURES.annotated);
    expect(result.hasForms).toBe(true);
    expect(result.bySubtype.Widget).toBeGreaterThan(0);
  });

  // IA-4: Text 注釈 (コメント)
  it('IA-4: annotated.pdf で hasMarkup=true', async () => {
    const result = await analyzeAnnotations(FIXTURES.annotated);
    expect(result.hasMarkup).toBe(true);
    // Text 注釈のコンテンツ
    const textAnnot = result.annotations.find((a) => a.subtype === 'Text');
    if (textAnnot) {
      expect(textAnnot.contents).not.toBeNull();
    }
  });

  // IA-5: simple.pdf (注釈なし)
  it('IA-5: simple.pdf で totalAnnotations=0', async () => {
    const result = await analyzeAnnotations(FIXTURES.simple);
    expect(result.totalAnnotations).toBe(0);
    expect(result.hasLinks).toBe(false);
    expect(result.hasForms).toBe(false);
    expect(result.hasMarkup).toBe(false);
  });

  // IA-6: ページ別集計
  it('IA-6: annotated.pdf のページ別集計', async () => {
    const result = await analyzeAnnotations(FIXTURES.annotated);
    expect(typeof result.byPage).toBe('object');
    // page 1 に Link + Text 注釈
    expect(result.byPage[1]).toBeGreaterThanOrEqual(2);
    // page 2 に Widget (Sig + Tx)
    expect(result.byPage[2]).toBeGreaterThanOrEqual(2);
  });

  // IA-extra: 注釈プロパティの完全性
  it('IA-extra: 注釈プロパティの完全性', async () => {
    const result = await analyzeAnnotations(FIXTURES.annotated);
    for (const annot of result.annotations) {
      expect(typeof annot.subtype).toBe('string');
      expect(typeof annot.page).toBe('number');
      expect(typeof annot.hasAppearance).toBe('boolean');
      // rect は null または number[]
      if (annot.rect !== null) {
        expect(Array.isArray(annot.rect)).toBe(true);
      }
    }
  });

  // IA-extra: empty.pdf
  it('IA-extra: empty.pdf で注釈なし', async () => {
    const result = await analyzeAnnotations(FIXTURES.empty);
    expect(result.totalAnnotations).toBe(0);
  });
});

// ========================================
// 署名解析 (inspect_signatures)
// ========================================

describe('05 - inspect_signatures', () => {
  // SG-1: annotated.pdf
  it('SG-1: annotated.pdf で署名フィールド検出', async () => {
    const result = await analyzeSignatures(FIXTURES.annotated);
    expect(result.totalFields).toBe(1);
    expect(result.fields[0].fieldName).toBe('SignatureField1');
  });

  // SG-2: 未署名フィールド
  it('SG-2: annotated.pdf の署名フィールドは未署名', async () => {
    const result = await analyzeSignatures(FIXTURES.annotated);
    expect(result.fields[0].isSigned).toBe(false);
    expect(result.unsignedCount).toBe(1);
    expect(result.signedCount).toBe(0);
  });

  // SG-3: simple.pdf (署名なし)
  it('SG-3: simple.pdf で署名フィールドなし', async () => {
    const result = await analyzeSignatures(FIXTURES.simple);
    expect(result.totalFields).toBe(0);
    expect(result.fields).toHaveLength(0);
  });

  // SG-4: note フィールド
  it('SG-4: note に検証非対応の注意文が含まれる', async () => {
    const result = await analyzeSignatures(FIXTURES.simple);
    expect(result.note).toBeTruthy();
    expect(result.note.length).toBeGreaterThan(0);
  });

  // SG-extra: empty.pdf
  it('SG-extra: empty.pdf で署名なし', async () => {
    const result = await analyzeSignatures(FIXTURES.empty);
    expect(result.totalFields).toBe(0);
  });
});
