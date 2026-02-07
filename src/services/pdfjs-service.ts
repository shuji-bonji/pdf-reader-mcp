/**
 * pdfjs-dist wrapper service.
 *
 * Centralizes all pdfjs-dist interactions for reuse across tools.
 */

import {
  OPS,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';
import { DEFAULT_SEARCH_CONTEXT } from '../constants.js';
import { detectEncryption } from './pdflib-service.js';
import type {
  AnnotationInfo,
  AnnotationsAnalysis,
  ExtractedImage,
  ImageExtractionResult,
  PageText,
  PdfMetadata,
  SearchMatch,
  TagNode,
  TagsAnalysis,
} from '../types.js';
import { getFileSize, readPdfFile, resolvePageNumbers } from '../utils/pdf-helpers.js';

/**
 * pdfjs-dist verbosity level: ERRORS only (suppress warnings from stdout).
 * pdfjs-dist's warn() uses console.log internally, which pollutes the
 * stdio JSON-RPC stream. Setting verbosity to 0 prevents this.
 */
const PDFJS_VERBOSITY = 0; // VerbosityLevel.ERRORS

/**
 * Load a PDF document from a file path.
 */
export async function loadDocument(filePath: string): Promise<PDFDocumentProxy> {
  const data = await readPdfFile(filePath);
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: PDFJS_VERBOSITY }).promise;
  return doc;
}

/**
 * Load a PDF document from a Uint8Array.
 */
export async function loadDocumentFromData(data: Uint8Array): Promise<PDFDocumentProxy> {
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: PDFJS_VERBOSITY }).promise;
  return doc;
}

/**
 * Get full metadata from a PDF document.
 */
export async function getMetadata(filePath: string): Promise<PdfMetadata> {
  const doc = await loadDocument(filePath);
  try {
    return await getMetadataFromDoc(doc, filePath);
  } finally {
    await doc.destroy();
  }
}

/**
 * Get full metadata from a pre-loaded PDFDocumentProxy.
 * Does NOT destroy the document — caller is responsible for lifecycle.
 */
export async function getMetadataFromDoc(
  doc: PDFDocumentProxy,
  filePath: string,
): Promise<PdfMetadata> {
  const fileSize = await getFileSize(filePath);
  const meta = await doc.getMetadata();
  const info = meta.info as Record<string, unknown>;

  // Check if tagged
  const markInfo = await getMarkInfo(doc);
  const isTagged = markInfo?.Marked === true;

  // Check signatures (heuristic check via first few pages)
  const hasSignatures = await checkSignatures(doc);

  return {
    title: asStringOrNull(info.Title),
    author: asStringOrNull(info.Author),
    subject: asStringOrNull(info.Subject),
    keywords: asStringOrNull(info.Keywords),
    creator: asStringOrNull(info.Creator),
    producer: asStringOrNull(info.Producer),
    creationDate: asStringOrNull(info.CreationDate),
    modificationDate: asStringOrNull(info.ModDate),
    pageCount: doc.numPages,
    pdfVersion: asStringOrNull(info.PDFFormatVersion),
    isLinearized: info.IsLinearized === true,
    isEncrypted: await detectEncryption(filePath),
    isTagged,
    hasSignatures,
    fileSize,
  };
}

/**
 * Extract text from a pre-loaded PDFDocumentProxy.
 * Does NOT destroy the document — caller is responsible for lifecycle.
 */
export async function extractTextFromDoc(
  doc: PDFDocumentProxy,
  pages?: string,
): Promise<PageText[]> {
  const pageNumbers = resolvePageNumbers(pages, doc.numPages);

  // 全ページを並列に処理（pdfjs-dist は並列ページアクセスが安全）
  const results = await Promise.all(
    pageNumbers.map(async (pageNum) => {
      const page = await doc.getPage(pageNum);
      const text = await extractPageText(page);
      return { page: pageNum, text };
    }),
  );

  return results;
}

/**
 * Extract text from specified pages (1-based).
 */
export async function extractText(filePath: string, pages?: string): Promise<PageText[]> {
  const doc = await loadDocument(filePath);

  try {
    return await extractTextFromDoc(doc, pages);
  } finally {
    await doc.destroy();
  }
}

/**
 * Search for text across all pages.
 */
export async function searchText(
  filePath: string,
  query: string,
  contextChars: number = DEFAULT_SEARCH_CONTEXT,
  pages?: string,
): Promise<SearchMatch[]> {
  const doc = await loadDocument(filePath);
  const lowerQuery = query.toLowerCase();

  try {
    const pageNumbers = resolvePageNumbers(pages, doc.numPages);

    // 全ページのテキストを並列に抽出
    const pageTexts = await Promise.all(
      pageNumbers.map(async (pageNum) => {
        const page = await doc.getPage(pageNum);
        const fullText = await extractPageText(page);
        return { pageNum, fullText };
      }),
    );

    // 抽出済みテキストからマッチを検索（CPU処理のみ、同期で十分）
    const matches: SearchMatch[] = [];
    for (const { pageNum, fullText } of pageTexts) {
      const lines = fullText.split('\n');

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const lowerLine = line.toLowerCase();
        let searchStart = 0;

        while (true) {
          const idx = lowerLine.indexOf(lowerQuery, searchStart);
          if (idx === -1) break;

          const matchText = line.slice(idx, idx + query.length);
          const contextBefore = line.slice(Math.max(0, idx - contextChars), idx);
          const contextAfter = line.slice(
            idx + query.length,
            Math.min(line.length, idx + query.length + contextChars),
          );

          matches.push({
            page: pageNum,
            lineIndex: lineIdx,
            text: matchText,
            contextBefore,
            contextAfter,
          });

          searchStart = idx + query.length;
        }
      }
    }

    return matches;
  } finally {
    await doc.destroy();
  }
}

/**
 * Count images from a pre-loaded PDFDocumentProxy.
 * Does NOT destroy the document — caller is responsible for lifecycle.
 */
export async function countImagesFromDoc(doc: PDFDocumentProxy, pages?: string): Promise<number> {
  const pageNumbers = resolvePageNumbers(pages, doc.numPages);

  // 全ページのオペレータリストを並列取得し、画像数を集計
  const counts = await Promise.all(
    pageNumbers.map(async (pageNum) => {
      const page = await doc.getPage(pageNum);
      const opList = await page.getOperatorList();
      let count = 0;
      for (const op of opList.fnArray) {
        if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
          count++;
        }
      }
      return count;
    }),
  );

  return counts.reduce((sum, c) => sum + c, 0);
}

/**
 * Count images on specified pages.
 */
export async function countImages(filePath: string, pages?: string): Promise<number> {
  const doc = await loadDocument(filePath);

  try {
    return await countImagesFromDoc(doc, pages);
  } finally {
    await doc.destroy();
  }
}

/**
 * Extract images from specified pages as base64.
 * Returns both extracted images and counts of detected/skipped images.
 */
export async function extractImages(
  filePath: string,
  pages?: string,
): Promise<ImageExtractionResult> {
  const doc = await loadDocument(filePath);

  try {
    const pageNumbers = resolvePageNumbers(pages, doc.numPages);

    // 全ページの画像抽出を並列実行
    const pageResults = await Promise.all(
      pageNumbers.map(async (pageNum) => {
        const page = await doc.getPage(pageNum);
        const opList = await page.getOperatorList();

        const pageImages: ExtractedImage[] = [];
        let pageDetected = 0;
        let imageIndex = 0;

        for (let i = 0; i < opList.fnArray.length; i++) {
          const op = opList.fnArray[i];
          if (op === OPS.paintImageXObject) {
            pageDetected++;
            try {
              const imgName = opList.argsArray[i][0] as string;
              const objs = page.objs;
              const imgData = objs.get(imgName) as {
                width: number;
                height: number;
                data: Uint8Array | Uint8ClampedArray;
                kind: number;
              } | null;

              if (imgData?.data) {
                const base64 = Buffer.from(imgData.data).toString('base64');
                const colorSpace =
                  imgData.kind === 1 ? 'RGB' : imgData.kind === 2 ? 'RGBA' : 'Grayscale';

                pageImages.push({
                  page: pageNum,
                  index: imageIndex,
                  width: imgData.width,
                  height: imgData.height,
                  colorSpace,
                  bitsPerComponent: 8,
                  dataBase64: base64,
                });
              }
            } catch {
              // Some images may not be directly accessible; skip
            }
            imageIndex++;
          }
        }
        return { pageImages, pageDetected };
      }),
    );

    // 各ページの結果を集約
    const images = pageResults.flatMap((r) => r.pageImages);
    const detectedCount = pageResults.reduce((sum, r) => sum + r.pageDetected, 0);

    return {
      images,
      detectedCount,
      extractedCount: images.length,
      skippedCount: detectedCount - images.length,
    };
  } finally {
    await doc.destroy();
  }
}

// ─── Internal helpers ────────────────────────────────────────

/**
 * Extract text from a single page with Y-coordinate-based line ordering.
 */
async function extractPageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  const items = content.items.filter(
    (item): item is TextItem => 'str' in item && item.str !== undefined,
  );

  if (items.length === 0) return '';

  // Sort by Y descending (top to bottom), then X ascending (left to right)
  items.sort((a, b) => {
    const ay = a.transform[5];
    const by = b.transform[5];
    const yDiff = by - ay;
    if (Math.abs(yDiff) > 2) return yDiff; // Different lines
    return a.transform[4] - b.transform[4]; // Same line, sort by X
  });

  // Group into lines based on Y-coordinate proximity
  const lines: string[] = [];
  let currentLine: string[] = [];
  let lastY = items[0].transform[5];

  for (const item of items) {
    const y = item.transform[5];
    if (Math.abs(y - lastY) > 2) {
      // New line
      if (currentLine.length > 0) {
        lines.push(currentLine.join(' '));
        currentLine = [];
      }
    }
    currentLine.push(item.str);
    lastY = y;
  }

  if (currentLine.length > 0) {
    lines.push(currentLine.join(' '));
  }

  return lines.join('\n');
}

/**
 * Get MarkInfo dictionary from the catalog.
 */
async function getMarkInfo(doc: PDFDocumentProxy): Promise<Record<string, boolean> | null> {
  try {
    const markInfo = await doc.getMarkInfo();
    return markInfo;
  } catch {
    return null;
  }
}

/**
 * Check if the document has digital signatures.
 *
 * NOTE: This is a heuristic check that only scans the first 5 pages
 * for signature Widget annotations. It may miss signatures attached
 * to later pages. For comprehensive signature analysis, use the
 * `inspect_signatures` tool which uses AcroForm-based detection via pdf-lib.
 */
async function checkSignatures(doc: PDFDocumentProxy): Promise<boolean> {
  try {
    // 最初の5ページを並列チェックし、いずれかに署名フィールドがあれば true
    const pagesToCheck = Math.min(doc.numPages, 5);
    const pageNumbers = Array.from({ length: pagesToCheck }, (_, i) => i + 1);

    const results = await Promise.all(
      pageNumbers.map(async (pageNum) => {
        const page = await doc.getPage(pageNum);
        const annotations = await page.getAnnotations();
        return annotations.some((annot) => annot.subtype === 'Widget' && annot.fieldType === 'Sig');
      }),
    );

    return results.some((hasSig) => hasSig);
  } catch {
    return false;
  }
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

// ─── Tier 2: Structure analysis functions ────────────────

/**
 * Analyze Tagged PDF structure tree from a pre-loaded document.
 * Does NOT destroy the document — caller is responsible for lifecycle.
 */
export async function analyzeTagsFromDoc(doc: PDFDocumentProxy): Promise<TagsAnalysis> {
  // Check if tagged
  const markInfo = await getMarkInfo(doc);
  const isTagged = markInfo?.Marked === true;

  if (!isTagged) {
    return {
      isTagged: false,
      rootTag: null,
      maxDepth: 0,
      totalElements: 0,
      roleCounts: {},
    };
  }

  // 全ページの構造ツリーを並列取得
  const pageNumbers = Array.from({ length: doc.numPages }, (_, i) => i + 1);
  const pageResults = await Promise.all(
    pageNumbers.map(async (pageNum) => {
      const page = await doc.getPage(pageNum);
      try {
        const tree = await page.getStructTree();
        if (tree) {
          const localRoleCounts: Record<string, number> = {};
          const node = buildTagNode(tree, localRoleCounts, 1);
          return { node, roleCounts: localRoleCounts };
        }
      } catch {
        // Some pages may not have structure tree
      }
      return null;
    }),
  );

  // 各ページの結果を集約
  const roleCounts: Record<string, number> = {};
  let totalElements = 0;
  let maxDepth = 0;
  const rootChildren: TagNode[] = [];

  for (const result of pageResults) {
    if (!result) continue;
    rootChildren.push(result.node);
    totalElements += countTagElements(result.node);
    maxDepth = Math.max(maxDepth, getTagDepth(result.node));
    // ページごとの roleCounts をマージ
    for (const [role, count] of Object.entries(result.roleCounts)) {
      roleCounts[role] = (roleCounts[role] ?? 0) + count;
    }
  }

  const rootTag: TagNode | null =
    rootChildren.length > 0
      ? { role: 'StructTreeRoot', children: rootChildren, contentCount: 0 }
      : null;

  if (rootTag) {
    maxDepth += 1; // Account for the root level
  }

  return {
    isTagged,
    rootTag,
    maxDepth,
    totalElements,
    roleCounts,
  };
}

/**
 * Analyze Tagged PDF structure tree.
 */
export async function analyzeTags(filePath: string): Promise<TagsAnalysis> {
  const doc = await loadDocument(filePath);
  try {
    return await analyzeTagsFromDoc(doc);
  } finally {
    await doc.destroy();
  }
}

/**
 * Analyze annotations across all pages.
 */
export async function analyzeAnnotations(
  filePath: string,
  pages?: string,
): Promise<AnnotationsAnalysis> {
  const doc = await loadDocument(filePath);

  try {
    const pageNumbers = resolvePageNumbers(pages, doc.numPages);

    const markupSubtypes = new Set([
      'Text',
      'FreeText',
      'Line',
      'Square',
      'Circle',
      'Polygon',
      'PolyLine',
      'Highlight',
      'Underline',
      'Squiggly',
      'StrikeOut',
      'Stamp',
      'Caret',
      'Ink',
      'Popup',
      'Redact',
    ]);

    // 全ページのアノテーションを並列取得
    const pageResults = await Promise.all(
      pageNumbers.map(async (pageNum) => {
        const page = await doc.getPage(pageNum);
        const annots = await page.getAnnotations();

        const pageAnnotations: AnnotationInfo[] = [];
        const pageBySubtype: Record<string, number> = {};
        let pageHasLinks = false;
        let pageHasForms = false;
        let pageHasMarkup = false;

        for (const annot of annots) {
          const subtype: string = annot.subtype ?? 'Unknown';

          pageBySubtype[subtype] = (pageBySubtype[subtype] ?? 0) + 1;

          if (subtype === 'Link') pageHasLinks = true;
          if (subtype === 'Widget') pageHasForms = true;
          if (markupSubtypes.has(subtype)) pageHasMarkup = true;

          pageAnnotations.push({
            subtype,
            page: pageNum,
            rect: annot.rect ?? null,
            contents: asStringOrNull(annot.contentsObj?.str) ?? asStringOrNull(annot.contents),
            author: asStringOrNull(annot.titleObj?.str) ?? null,
            modificationDate: asStringOrNull(annot.modificationDate) ?? null,
            hasAppearance: annot.hasAppearance === true,
          });
        }

        return {
          pageNum,
          annotations: pageAnnotations,
          bySubtype: pageBySubtype,
          hasLinks: pageHasLinks,
          hasForms: pageHasForms,
          hasMarkup: pageHasMarkup,
        };
      }),
    );

    // 各ページの結果を集約
    const annotations: AnnotationInfo[] = [];
    const bySubtype: Record<string, number> = {};
    const byPage: Record<number, number> = {};
    let hasLinks = false;
    let hasForms = false;
    let hasMarkup = false;

    for (const result of pageResults) {
      annotations.push(...result.annotations);
      byPage[result.pageNum] = result.annotations.length;
      hasLinks = hasLinks || result.hasLinks;
      hasForms = hasForms || result.hasForms;
      hasMarkup = hasMarkup || result.hasMarkup;
      for (const [subtype, count] of Object.entries(result.bySubtype)) {
        bySubtype[subtype] = (bySubtype[subtype] ?? 0) + count;
      }
    }

    return {
      totalAnnotations: annotations.length,
      bySubtype,
      byPage,
      annotations,
      hasLinks,
      hasForms,
      hasMarkup,
    };
  } finally {
    await doc.destroy();
  }
}

// ─── Tag tree helpers ────────────────────────────────────

interface StructTreeNodeLike {
  role?: string;
  children?: Array<StructTreeNodeLike | StructTreeContentLike>;
}

interface StructTreeContentLike {
  type: string;
  id?: string;
}

function buildTagNode(
  node: StructTreeNodeLike,
  roleCounts: Record<string, number>,
  depth: number,
): TagNode {
  const role = node.role ?? 'Unknown';
  roleCounts[role] = (roleCounts[role] ?? 0) + 1;

  const children: TagNode[] = [];
  let contentCount = 0;

  if (node.children) {
    for (const child of node.children) {
      if ('role' in child) {
        children.push(buildTagNode(child as StructTreeNodeLike, roleCounts, depth + 1));
      } else {
        contentCount++;
      }
    }
  }

  return { role, children, contentCount };
}

function countTagElements(node: TagNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countTagElements(child);
  }
  return count;
}

function getTagDepth(node: TagNode): number {
  if (node.children.length === 0) return 1;
  let max = 0;
  for (const child of node.children) {
    max = Math.max(max, getTagDepth(child));
  }
  return max + 1;
}
