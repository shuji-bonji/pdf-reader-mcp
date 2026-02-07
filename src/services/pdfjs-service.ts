/**
 * pdfjs-dist wrapper service.
 *
 * Centralizes all pdfjs-dist interactions for reuse across tools.
 */

import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';
import { DEFAULT_SEARCH_CONTEXT } from '../constants.js';
import type { ExtractedImage, PageText, PdfMetadata, SearchMatch } from '../types.js';
import { getFileSize, parsePageRange, readPdfFile } from '../utils/pdf-helpers.js';

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
  const fileSize = await getFileSize(filePath);

  try {
    const meta = await doc.getMetadata();
    const info = meta.info as Record<string, unknown>;

    // Check if tagged
    const markInfo = await getMarkInfo(doc);
    const isTagged = markInfo?.Marked === true;

    // Check signatures (presence of signature fields in AcroForm)
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
      isEncrypted: false, // TODO: Tier 2 で暗号化チェックを実装
      isTagged,
      hasSignatures,
      fileSize,
    };
  } finally {
    await doc.destroy();
  }
}

/**
 * Extract text from specified pages (1-based).
 */
export async function extractText(filePath: string, pages?: string): Promise<PageText[]> {
  const doc = await loadDocument(filePath);

  try {
    const pageNumbers =
      parsePageRange(pages, doc.numPages) ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);

    const results: PageText[] = [];
    for (const pageNum of pageNumbers) {
      const page = await doc.getPage(pageNum);
      const text = await extractPageText(page);
      results.push({ page: pageNum, text });
    }

    return results;
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
    const pageNumbers =
      parsePageRange(pages, doc.numPages) ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);

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
 * Count images on specified pages.
 */
export async function countImages(filePath: string, pages?: string): Promise<number> {
  const doc = await loadDocument(filePath);

  try {
    const pageNumbers =
      parsePageRange(pages, doc.numPages) ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);

    let total = 0;
    for (const pageNum of pageNumbers) {
      const page = await doc.getPage(pageNum);
      const opList = await page.getOperatorList();
      // OPS.paintImageXObject = 85, OPS.paintJpegXObject = 82
      for (const op of opList.fnArray) {
        if (op === 85 || op === 82) {
          total++;
        }
      }
    }

    return total;
  } finally {
    await doc.destroy();
  }
}

/**
 * Extract images from specified pages as base64.
 */
export async function extractImages(filePath: string, pages?: string): Promise<ExtractedImage[]> {
  const doc = await loadDocument(filePath);

  try {
    const pageNumbers =
      parsePageRange(pages, doc.numPages) ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);

    const images: ExtractedImage[] = [];

    for (const pageNum of pageNumbers) {
      const page = await doc.getPage(pageNum);
      const opList = await page.getOperatorList();

      let imageIndex = 0;
      for (let i = 0; i < opList.fnArray.length; i++) {
        const op = opList.fnArray[i];
        // OPS.paintImageXObject = 85
        if (op === 85) {
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
              // Convert raw pixel data to base64
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

    return images;
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
