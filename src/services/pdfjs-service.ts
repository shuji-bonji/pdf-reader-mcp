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

  const results: PageText[] = [];
  for (const pageNum of pageNumbers) {
    const page = await doc.getPage(pageNum);
    const text = await extractPageText(page);
    results.push({ page: pageNum, text });
  }

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

    const matches: SearchMatch[] = [];

    for (const pageNum of pageNumbers) {
      const page = await doc.getPage(pageNum);
      const fullText = await extractPageText(page);
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

  let total = 0;
  for (const pageNum of pageNumbers) {
    const page = await doc.getPage(pageNum);
    const opList = await page.getOperatorList();
    for (const op of opList.fnArray) {
      if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
        total++;
      }
    }
  }

  return total;
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

    const images: ExtractedImage[] = [];
    let detectedCount = 0;

    for (const pageNum of pageNumbers) {
      const page = await doc.getPage(pageNum);
      const opList = await page.getOperatorList();

      let imageIndex = 0;
      for (let i = 0; i < opList.fnArray.length; i++) {
        const op = opList.fnArray[i];
        if (op === OPS.paintImageXObject) {
          detectedCount++;
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

              images.push({
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
    }

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
    // Check for signature fields in annotations across first few pages
    const pagesToCheck = Math.min(doc.numPages, 5);
    for (let i = 1; i <= pagesToCheck; i++) {
      const page = await doc.getPage(i);
      const annotations = await page.getAnnotations();
      for (const annot of annotations) {
        if (annot.subtype === 'Widget' && annot.fieldType === 'Sig') {
          return true;
        }
      }
    }
    return false;
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
 * Analyze Tagged PDF structure tree.
 */
export async function analyzeTags(filePath: string): Promise<TagsAnalysis> {
  const doc = await loadDocument(filePath);

  try {
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

    // Collect structure trees from all pages
    const roleCounts: Record<string, number> = {};
    let totalElements = 0;
    let maxDepth = 0;
    const rootChildren: TagNode[] = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      try {
        const tree = await page.getStructTree();
        if (tree) {
          const node = buildTagNode(tree, roleCounts, 1);
          totalElements += countTagElements(node);
          maxDepth = Math.max(maxDepth, getTagDepth(node));
          rootChildren.push(node);
        }
      } catch {
        // Some pages may not have structure tree
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

    const annotations: AnnotationInfo[] = [];
    const bySubtype: Record<string, number> = {};
    const byPage: Record<number, number> = {};
    let hasLinks = false;
    let hasForms = false;
    let hasMarkup = false;

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

    for (const pageNum of pageNumbers) {
      const page = await doc.getPage(pageNum);
      const annots = await page.getAnnotations();

      for (const annot of annots) {
        const subtype: string = annot.subtype ?? 'Unknown';

        bySubtype[subtype] = (bySubtype[subtype] ?? 0) + 1;
        byPage[pageNum] = (byPage[pageNum] ?? 0) + 1;

        if (subtype === 'Link') hasLinks = true;
        if (subtype === 'Widget') hasForms = true;
        if (markupSubtypes.has(subtype)) hasMarkup = true;

        annotations.push({
          subtype,
          page: pageNum,
          rect: annot.rect ?? null,
          contents: asStringOrNull(annot.contentsObj?.str) ?? asStringOrNull(annot.contents),
          author: asStringOrNull(annot.titleObj?.str) ?? null,
          modificationDate: asStringOrNull(annot.modificationDate) ?? null,
          hasAppearance: annot.hasAppearance === true,
        });
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
