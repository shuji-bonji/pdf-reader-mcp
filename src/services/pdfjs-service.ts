/**
 * pdfjs-dist wrapper service.
 *
 * Centralizes all pdfjs-dist interactions for reuse across tools.
 */

import {
  getDocument,
  ImageKind,
  OPS,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';
import { DEFAULT_SEARCH_CONTEXT } from '../constants.js';
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
import { detectEncryption } from './pdflib-service.js';

/**
 * pdfjs-dist verbosity level: ERRORS only (suppress warnings from stdout).
 * pdfjs-dist's warn() uses console.log internally, which pollutes the
 * stdio JSON-RPC stream. Setting verbosity to 0 prevents this.
 */
const PDFJS_VERBOSITY = 0; // VerbosityLevel.ERRORS

/**
 * How long to wait for a single decoded image to arrive from the pdfjs worker
 * before giving up on it (see `getPageObject`). Generous: it only elapses for
 * images the worker never delivers, and a slow decode is still better than a
 * silently dropped image.
 */
const IMAGE_OBJECT_TIMEOUT_MS = 10_000;

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
 * Options for text extraction.
 *
 * - `splitColumns` controls Issue #3 column-aware reordering. When `>= 2`,
 *   text items are bucketed into N equal-width columns by X-coordinate and
 *   concatenated left-to-right. `1` (default / undefined) preserves the
 *   existing single-column Y-sort behaviour.
 * - `compactWhitespace` controls Issue #4 whitespace normalization. When
 *   `true`, runs of `\s` plus U+3000 collapse to one ASCII space and each
 *   line is trimmed. Default `false` preserves original spacing.
 */
export interface ExtractTextOptions {
  splitColumns?: number;
  compactWhitespace?: boolean;
}

/**
 * Extract text from a pre-loaded PDFDocumentProxy.
 * Does NOT destroy the document — caller is responsible for lifecycle.
 */
export async function extractTextFromDoc(
  doc: PDFDocumentProxy,
  pages?: string,
  options: ExtractTextOptions = {},
): Promise<PageText[]> {
  const pageNumbers = resolvePageNumbers(pages, doc.numPages);

  // 全ページを並列に処理（pdfjs-dist は並列ページアクセスが安全）
  const results = await Promise.all(
    pageNumbers.map(async (pageNum) => {
      const page = await doc.getPage(pageNum);
      const text = await extractPageText(page, options);
      return { page: pageNum, text };
    }),
  );

  return results;
}

/**
 * Extract text from specified pages (1-based).
 */
export async function extractText(
  filePath: string,
  pages?: string,
  options: ExtractTextOptions = {},
): Promise<PageText[]> {
  const doc = await loadDocument(filePath);

  try {
    return await extractTextFromDoc(doc, pages, options);
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
 * Map pdfjs `ImageKind` to the colour space and bits-per-component we report.
 *
 * These describe the *decoded* buffer pdfjs hands back, not the raw PDF image
 * XObject: pdfjs normalises the ColorSpace / BitsPerComponent of §8.9.5.1 into
 * one of three layouts. GRAYSCALE_1BPP is 1 bit per pixel; the RGB/RGBA kinds
 * are 8 bits per component (24bpp = 3×8, 32bpp = 4×8).
 *
 * The constants are imported from pdfjs rather than hardcoded — the previous
 * implementation inlined the numbers and had all three wrong.
 */
export function describeImageKind(kind: number | undefined): {
  colorSpace: string;
  bitsPerComponent: number;
} {
  switch (kind) {
    case ImageKind.GRAYSCALE_1BPP:
      return { colorSpace: 'Grayscale', bitsPerComponent: 1 };
    case ImageKind.RGB_24BPP:
      return { colorSpace: 'RGB', bitsPerComponent: 8 };
    case ImageKind.RGBA_32BPP:
      return { colorSpace: 'RGBA', bitsPerComponent: 8 };
    default:
      return { colorSpace: 'Unknown', bitsPerComponent: 8 };
  }
}

/** Decoded image object handed back by pdfjs. */
interface PdfjsImageData {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
  kind: number;
}

/**
 * Resolve a pdfjs image object, waiting for it to arrive from the worker.
 *
 * Two things have to be right here, and both were wrong before:
 *
 * 1. **Wait for it.** `objs.get(name)` — the synchronous form — throws
 *    `Requesting object that isn't resolved yet`. `getOperatorList()` resolves
 *    once the operator list is complete, but decoded image data is pushed from
 *    the worker separately and lands later. The callback form registers a
 *    listener and fires when it does. Using the sync form meant every image
 *    threw, was swallowed as "skipped", and `read_images` returned zero images
 *    for every PDF.
 *
 * 2. **Look in the right pool.** Images shared across pages are placed in
 *    `commonObjs`, not `objs`, and pdfjs marks them with a `g_` name prefix.
 *    Asking `objs` for one waits forever. pdfjs itself dispatches on exactly
 *    this prefix (`getObject`: `data.startsWith("g_") ? this.commonObjs :
 *    this.objs`), so we mirror its rule rather than inventing one.
 *
 * The timeout is a backstop for an object that genuinely never arrives; without
 * it the callback would never fire and the request would hang. It should not be
 * the normal path — if it starts elapsing, something else is wrong.
 */
function getImageObject(
  page: PDFPageProxy,
  name: string,
  timeoutMs: number = IMAGE_OBJECT_TIMEOUT_MS,
): Promise<PdfjsImageData | undefined> {
  // Mirrors pdfjs's own CanvasGraphics.getObject dispatch.
  const pool = name.startsWith('g_') ? page.commonObjs : page.objs;

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    try {
      pool.get(name, (data: unknown) => {
        clearTimeout(timer);
        resolve((data as PdfjsImageData) ?? undefined);
      });
    } catch {
      // Malformed reference — treat as unavailable rather than failing the page.
      clearTimeout(timer);
      resolve(undefined);
    }
  });
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
            const imgName = opList.argsArray[i][0] as string;
            const imgData = await getImageObject(page, imgName);

            if (imgData?.data) {
              const base64 = Buffer.from(imgData.data).toString('base64');
              const { colorSpace, bitsPerComponent } = describeImageKind(imgData.kind);

              pageImages.push({
                page: pageNum,
                index: imageIndex,
                width: imgData.width,
                height: imgData.height,
                colorSpace,
                bitsPerComponent,
                dataBase64: base64,
              });
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
 *
 * Issue #3 (v0.4.0): when `options.splitColumns >= 2`, text items are first
 * partitioned into N equal-width X buckets, and each bucket is reordered
 * independently. The result is `bucket[0] (leftmost) → bucket[N-1]
 * (rightmost)`, with `\n\n` separators between buckets so a downstream LLM
 * can tell columns apart. Use this for **untagged** multi-column PDFs
 * (typical of older 新旧対照表 PDFs); Tagged PDFs with proper `<Table>`
 * markup should use `extract_tables` instead.
 */
async function extractPageText(
  page: PDFPageProxy,
  options: ExtractTextOptions = {},
): Promise<string> {
  const content = await page.getTextContent();
  const items = content.items.filter(
    (item): item is TextItem => 'str' in item && item.str !== undefined,
  );

  if (items.length === 0) return '';

  const splitColumns = options.splitColumns ?? 1;

  if (splitColumns >= 2) {
    // pdfjs-dist returns each page's `view` as [x1, y1, x2, y2] in user space.
    // For most documents the X range starts at 0, so x2 = page width.
    const view = page.view;
    const pageWidth = view[2] - view[0];
    const colWidth = pageWidth / splitColumns;

    const buckets: TextItem[][] = Array.from({ length: splitColumns }, () => []);
    for (const item of items) {
      const x = item.transform[4] - view[0];
      const colIdx = Math.min(Math.max(0, Math.floor(x / colWidth)), splitColumns - 1);
      buckets[colIdx].push(item);
    }

    const columnTexts = buckets.map((bucket) => itemsToText(bucket, options));
    return columnTexts.filter((s) => s.length > 0).join('\n\n');
  }

  return itemsToText(items, options);
}

/**
 * Reorder a flat list of TextItems by Y descending, then X ascending,
 * grouping into lines by Y proximity. Extracted from `extractPageText` so
 * the column-aware path can reuse the same line-grouping logic per bucket.
 *
 * If `options.compactWhitespace` is true, the assembled text passes through
 * `compactRuns` as a final step.
 */
function itemsToText(items: TextItem[], options: ExtractTextOptions = {}): string {
  if (items.length === 0) return '';

  // Sort by Y descending (top to bottom), then X ascending (left to right)
  const sorted = [...items].sort((a, b) => {
    const ay = a.transform[5];
    const by = b.transform[5];
    const yDiff = by - ay;
    if (Math.abs(yDiff) > 2) return yDiff; // Different lines
    return a.transform[4] - b.transform[4]; // Same line, sort by X
  });

  // Group into lines based on Y-coordinate proximity
  const lines: string[] = [];
  let currentLine: string[] = [];
  let lastY = sorted[0].transform[5];

  for (const item of sorted) {
    const y = item.transform[5];
    if (Math.abs(y - lastY) > 2) {
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

  const text = lines.join('\n');
  return options.compactWhitespace ? compactRuns(text) : text;
}

/**
 * Issue #4: collapse whitespace runs (incl. fullwidth U+3000) to one ASCII
 * space, trim each line, and drop lines that become empty after trimming.
 *
 * Newlines are preserved so paragraph / line structure stays readable.
 * Per-cell kerning whitespace ("消 費 税" → "消費税") is intentionally NOT
 * touched here — that requires CJK-aware logic and lives in
 * `extract_tables`'s `compactCellText`.
 */
function compactRuns(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[\s　]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Whether the document claims to be tagged (`/MarkInfo /Marked true`).
 *
 * Used by search_text to explain empty results on tagged documents (#15):
 * the search runs over raw glyphs, so text carried in `/ActualText`
 * replacements (§14.9.4) is invisible to it.
 */
export async function isTaggedPdf(filePath: string): Promise<boolean> {
  const doc = await loadDocument(filePath);
  try {
    const markInfo = await getMarkInfo(doc);
    return markInfo?.Marked === true;
  } catch {
    return false;
  } finally {
    await doc.destroy();
  }
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

// Note: inspect_tags no longer uses a pdfjs per-page walk. It builds its tree
// from the document's StructTreeRoot (`analyzeTags` in struct-tree-service.ts)
// so that page-spanning elements stay whole — see that file's C-1 note.
// `analyzeTagsFromDoc` below is retained only for the deprecated validate_tagged.

// Note: extract_tables no longer lives here. Like inspect_tags (C-1) it walks
// the document's StructTreeRoot so that a page-spanning Table stays ONE table —
// see `extractTables` in struct-tree-service.ts (#14). The per-page
// `page.getStructTree()` walk this file used to host sliced such tables into
// per-page fragments and emitted phantom empty tables on pages that carried
// only their Figures.

/** A `getTextContent({ includeMarkedContent: true })` item. */
export interface TextContentItemLike {
  type?: string;
  id?: string | null;
  tag?: string;
  str?: string;
  hasEOL?: boolean;
}

/**
 * Build a map from a marked-content `id` (e.g. `p715R_mc4`) to the concatenated
 * raw text inside the corresponding `beginMarkedContentProps`/`endMarkedContent`
 * pair. Nested marked content is supported via a stack — text counts toward
 * every active id (so a `<Span>` inside a `<P>` contributes to both).
 *
 * Items with `tag === 'Artifact'` are page-level artifacts (page numbers,
 * running headers, etc.) outside the structure tree, and are skipped.
 *
 * The text is kept RAW, with line breaks as `\n` markers (see the note where the
 * map is built): line breaks often fall between marked-content sequences, so
 * they can only be resolved once the sequences are joined by the caller.
 */
export function buildIdToTextMap(items: TextContentItemLike[]): Map<string, string> {
  const map = new Map<string, string[]>();
  const stack: { id: string | null; isArtifact: boolean }[] = [];

  for (const item of items) {
    const t = item.type;
    if (t === 'beginMarkedContent' || t === 'beginMarkedContentProps') {
      const isArtifact = item.tag === 'Artifact';
      const id = item.id ?? null;
      stack.push({ id, isArtifact });
      continue;
    }
    if (t === 'endMarkedContent') {
      stack.pop();
      continue;
    }
    if (t !== undefined) continue; // unknown marker
    // Text item
    if (stack.some((s) => s.isArtifact)) continue;
    // pdfjs emits line breaks as their own items (`str: ''`, `hasEOL: true`).
    // Record them as `\n` and decide what they mean in `resolveLineBreaks`,
    // where the surrounding characters are known.
    const str = item.hasEOL ? LINE_BREAK : (item.str ?? '');
    if (!str) continue;
    for (const frame of stack) {
      if (frame.id) {
        const buf = map.get(frame.id);
        if (buf) buf.push(str);
        else map.set(frame.id, [str]);
      }
    }
  }

  // Keep the line-break markers; do NOT resolve them here. Each line of a
  // paragraph is often its OWN marked-content sequence, so a line break falls
  // *between* two ids, not inside one. resolveLineBreaks must therefore run
  // after the ids are joined (in `textOf` / `compactCellText`), where it can see
  // that the character ending one id and the one starting the next are both CJK.
  // Resolving per id turned the break into a leading space and welded it into the
  // joined text — 「…大 量に…」.
  const out = new Map<string, string>();
  for (const [id, parts] of map) out.set(id, parts.join(''));
  return out;
}

/**
 * Placeholder for a line break, resolved by `resolveLineBreaks`.
 *
 * Exported because a page boundary inside one structure element is also a line
 * break, and only the caller assembling across pages knows where those fall
 * (pdfjs emits no EOL marker at the start of a page).
 */
export const LINE_BREAK = '\n';

/**
 * CJK code points — scripts that do not separate words with spaces.
 *
 *  - `U+3000–U+303F` CJK Symbols and Punctuation (、。「」etc.)
 *  - `U+3040–U+30FF` Hiragana and Katakana
 *  - `U+3400–U+9FFF` CJK Unified Ideographs (incl. Extension A)
 *  - `U+FF00–U+FFEF` Halfwidth and Fullwidth Forms
 *
 * The punctuation block matters: it starts at U+3000, so a range beginning at
 * U+3040 silently excludes 。and 「 — and a line can legitimately break before an
 * opening bracket, which would then gain a space that was never in the document.
 */
const CJK_CHAR = '[\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef]';

/** A line break with CJK on both sides — no space belongs there. */
const CJK_LINE_BREAK = new RegExp(`(?<=${CJK_CHAR})${LINE_BREAK}(?=${CJK_CHAR})`, 'g');

/**
 * Turn the line breaks of the *original layout* into text.
 *
 * A line break between two words is a word break, so it becomes a space. A line
 * break between two CJK characters is not: Japanese does not separate words with
 * spaces, so the original wrap point would otherwise be welded into the content
 * as a space that was never in the document.
 *
 * ISO 32000-2 §14.8.2.6.2 requires that "any white-space characters that **would
 * be present to separate words in a pure text representation** shall be present"
 * — for Japanese there are none, and the same clause notes that "a word is
 * defined by **script and context**". So a space here would be ours, not the
 * document's, and it contradicts the point of reflow: the new layout re-wraps,
 * and the original wrap points are not content.
 *
 * Verified: a Japanese paragraph that wrapped mid-sentence used to extract as
 * 「…埋め草を大量 に含みます」.
 */
export function resolveLineBreaks(text: string): string {
  return text.replace(CJK_LINE_BREAK, '').replace(new RegExp(LINE_BREAK, 'g'), ' ');
}

/**
 * Build the marked-content id → text map across the whole document.
 *
 * The per-page map is what `extract_tables` needs, because a table lives on one
 * page. `extract_structured_text` needs the document-wide map instead: a single
 * structure element can own content on several pages (ISO 32000-2 §14.8.2.5
 * NOTE 2), so its text has to be assembled from more than one page's items.
 *
 * The ids are globally unique — pdfjs builds them from the page object number
 * (`p7R_mc0`) — so merging the per-page maps is safe.
 */
export async function buildDocumentIdToTextMap(
  doc: PDFDocumentProxy,
): Promise<Map<string, string>> {
  const perPage = await Promise.all(
    Array.from({ length: doc.numPages }, async (_, i) => {
      const page = await doc.getPage(i + 1);
      const content = await page.getTextContent({ includeMarkedContent: true });
      return buildIdToTextMap(content.items as TextContentItemLike[]);
    }),
  );

  const merged = new Map<string, string>();
  for (const map of perPage) {
    for (const [id, text] of map) merged.set(id, text);
  }
  return merged;
}

/**
 * Normalise raw cell text:
 *   0. Resolve line breaks (CJK-aware) — a break between two CJK characters is
 *      not a space. Must precede step 1, which would otherwise turn the break
 *      into a space that the step-2 fold cannot remove (it needs 2+ repeats).
 *   1. Collapse any whitespace run (`\s` + U+3000) to a single ASCII space.
 *   2. Fold per-character kerning runs between CJK characters
 *      (e.g. "消 費 税 法" → "消費税法") — but only when at least three
 *      single CJK chars are separated by single spaces in a row, so that
 *      natural inter-word spacing like "事業者 法人番号" is preserved.
 *   3. Trim and Markdown-escape pipes / newlines.
 */
export function compactCellText(s: string): string {
  if (!s) return '';
  // Step 0: CJK-aware line-break resolution (see resolveLineBreaks). idToText now
  // keeps raw `\n` markers, so a cell wrapping mid-word no longer gains a space.
  let t = resolveLineBreaks(s);
  // Step 1: collapse whitespace runs (incl. U+3000) to one ASCII space.
  t = t.replace(/[\s　]+/g, ' ').trim();
  // Step 2: fold runs of `CJK + space` repeated at least twice followed by
  // a final CJK char. Anything shorter is treated as a real word boundary.
  // Shares CJK_CHAR with resolveLineBreaks — one definition of "is this CJK".
  const kerningRun = new RegExp(`(?:${CJK_CHAR} ){2,}${CJK_CHAR}`, 'g');
  t = t.replace(kerningRun, (m) => m.replace(/ /g, ''));
  // Step 3: escape Markdown table delimiters.
  return t.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Annotation subtypes that are markup annotations.
 *
 * Transcribed from the "Markup" column of ISO 32000-2 Table 171 — Annotation
 * types. That column is normative and exhaustive, so this needs no
 * interpretation: every subtype the table marks "Yes" is here, and every one it
 * marks "No" (Link, Popup, Movie, Screen, Widget, PrinterMark, TrapNet,
 * Watermark, 3D, RichMedia) is not.
 *
 * Previously this set was assembled by hand and got three things wrong:
 *  - Popup was included. §12.5.6.2 is explicit: "The remaining annotation types
 *    are not considered markup annotations: • The popup annotation type shall
 *    not appear by itself; it shall be associated with a markup annotation…".
 *    A popup is the *container* for another annotation's text, not markup.
 *  - FileAttachment, Sound and Projection were missing, though Table 171 marks
 *    all three "Yes" (§12.5.6.2 lists file attachment among the annotations
 *    with a popup window, and gives sound and projection their own groups).
 *
 * Sound is deprecated in PDF 2.0 and Projection is new in PDF 2.0; both are
 * still markup, so both are reported as such.
 */
const MARKUP_SUBTYPES: ReadonlySet<string> = new Set([
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
  'Caret',
  'Stamp',
  'Ink',
  'FileAttachment',
  'Sound',
  'Redact',
  'Projection',
]);

/**
 * Report whether an annotation subtype is a markup annotation
 * (ISO 32000-2 Table 171, "Markup" column).
 */
export function isMarkupAnnotation(subtype: string): boolean {
  return MARKUP_SUBTYPES.has(subtype);
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
          if (isMarkupAnnotation(subtype)) pageHasMarkup = true;

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
