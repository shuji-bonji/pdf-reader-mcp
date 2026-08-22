/**
 * pdfjs-dist wrapper service.
 *
 * Centralizes all pdfjs-dist interactions for reuse across tools.
 */

import type { PDFDocument as PdfLibDocument } from 'pdf-lib';
import {
  getDocument,
  ImageKind,
  OPS,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_SEARCH_CONTEXT,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_RESPONSE_BYTES,
} from '../constants.js';
import type {
  AnnotationInfo,
  AnnotationsAnalysis,
  ExtractedImage,
  ImageExtractionResult,
  OmittedImage,
  PageText,
  PdfMetadata,
  SearchMatch,
  TagNode,
  TagsAnalysis,
} from '../types.js';
import { getFileSize, readPdfFile, resolvePageNumbers } from '../utils/pdf-helpers.js';
import {
  buildSpanActualTextMap,
  buildStructActualTextMap,
  foldActualText,
  type PositionedText,
} from './actual-text-service.js';
import { encodeJpeg, encodePng } from './image-encoder.js';
import {
  downscale,
  expandGrayscale1Bpp,
  flattenAlphaOverWhite,
  type Samples,
} from './image-resampler.js';
import { detectEncryption, loadWithPdfLib } from './pdflib-service.js';

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
 * Everything `/ActualText` resolution needs that pdfjs cannot supply (#18):
 * a pdf-lib view of the same file, for the structure tree and the content
 * streams. Absent when the file could not be opened with pdf-lib, in which case
 * extraction falls back to raw glyphs.
 */
interface ActualTextResolution {
  libDoc: PdfLibDocument;
  structActualText: ReadonlyMap<string, string>;
  /**
   * The document is encrypted, so neither path can run: §7.6.2 encrypts strings
   * and streams, and pdf-lib is loaded with `ignoreEncryption`. Recorded so the
   * caller can say *why* nothing was resolved — "the content stream did not
   * line up" would be a wrong and unactionable explanation here.
   */
  encrypted: boolean;
}

/** One page's extracted text, plus whether `Span`-level replacement was resolved. */
interface PageTextResult {
  text: string;
  markedContentResolved: boolean;
}

/** A `getTextContent({ includeMarkedContent: true })` item, as pdfjs types it loosely. */
interface RawTextContentItem {
  type?: string;
  id?: string | null;
  tag?: string;
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
  hasEOL?: boolean;
}

/**
 * Open the same file with pdf-lib so `/ActualText` can be resolved.
 *
 * Returns `undefined` rather than throwing: a file pdf-lib cannot parse is
 * still readable by pdfjs, and the pre-#18 behaviour (raw glyphs) is a valid
 * fallback. Callers report the degradation instead of failing.
 */
async function loadActualTextResolution(
  filePath: string,
): Promise<ActualTextResolution | undefined> {
  try {
    const libDoc = await loadWithPdfLib(filePath);
    return {
      libDoc,
      structActualText: buildStructActualTextMap(libDoc),
      encrypted: libDoc.isEncrypted,
    };
  } catch {
    return undefined;
  }
}

/**
 * Extract text from a pre-loaded PDFDocumentProxy.
 * Does NOT destroy the document — caller is responsible for lifecycle.
 */
export async function extractTextFromDoc(
  doc: PDFDocumentProxy,
  pages?: string,
  options: ExtractTextOptions = {},
  resolution?: ActualTextResolution,
): Promise<PageText[]> {
  const pageNumbers = resolvePageNumbers(pages, doc.numPages);

  // 全ページを並列に処理（pdfjs-dist は並列ページアクセスが安全）
  const results = await Promise.all(
    pageNumbers.map(async (pageNum) => {
      const page = await doc.getPage(pageNum);
      const { text } = await extractPageText(page, options, resolution);
      return { page: pageNum, text };
    }),
  );

  return results;
}

/**
 * Extract text from specified pages (1-based).
 *
 * Resolves `/ActualText` (ISO 32000-2 §14.9.4) on both of the paths the clause
 * defines — see `actual-text-service`. The pdf-lib load that makes this possible
 * is best-effort: a file it cannot parse still extracts, as raw glyphs.
 */
export async function extractText(
  filePath: string,
  pages?: string,
  options: ExtractTextOptions = {},
): Promise<PageText[]> {
  const [doc, resolution] = await Promise.all([
    loadDocument(filePath),
    loadActualTextResolution(filePath),
  ]);

  try {
    return await extractTextFromDoc(doc, pages, options, resolution);
  } finally {
    await doc.destroy();
  }
}

/** What `search_text` gets back: the matches, and how complete the text was. */
export interface SearchTextResult {
  matches: SearchMatch[];
  /**
   * Pages where `/ActualText` could not be resolved (§14.9.4). A miss on one of
   * these pages may still be a replacement the search could not see — which is
   * what #15 warned about, now narrowed to the cases where it is actually true.
   */
  unresolvedPages: number[];
  /**
   * Why `unresolvedPages` is non-empty. `encrypted` means the whole document is
   * out of reach and no other tool of this server will do better; `unaligned`
   * means the content stream of those particular pages could not be matched up
   * with the extracted text.
   */
  unresolvedReason?: 'encrypted' | 'unaligned';
}

/**
 * Search for text across all pages.
 *
 * Searches the same text `read_text` returns, `/ActualText` included (#18), so
 * the two tools can no longer disagree about whether a word is in the document.
 */
export async function searchText(
  filePath: string,
  query: string,
  contextChars: number = DEFAULT_SEARCH_CONTEXT,
  pages?: string,
): Promise<SearchTextResult> {
  const [doc, resolution] = await Promise.all([
    loadDocument(filePath),
    loadActualTextResolution(filePath),
  ]);
  const lowerQuery = query.toLowerCase();

  try {
    const pageNumbers = resolvePageNumbers(pages, doc.numPages);

    // 全ページのテキストを並列に抽出
    const pageTexts = await Promise.all(
      pageNumbers.map(async (pageNum) => {
        const page = await doc.getPage(pageNum);
        const { text: fullText, markedContentResolved } = await extractPageText(
          page,
          {},
          resolution,
        );
        return { pageNum, fullText, markedContentResolved };
      }),
    );

    const unresolvedPages = pageTexts.filter((p) => !p.markedContentResolved).map((p) => p.pageNum);
    // Encryption disables both paths for the whole document, so it outranks the
    // per-page alignment explanation whenever it applies.
    const unresolvedReason =
      unresolvedPages.length === 0
        ? undefined
        : resolution?.encrypted
          ? ('encrypted' as const)
          : ('unaligned' as const);

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

    return { matches, unresolvedPages, unresolvedReason };
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

/** Options for {@link extractImages} (#22). */
export interface ExtractImagesOptions {
  /** Encoding of the returned image files. Default `png`. */
  format?: 'png' | 'jpeg';
  /** JPEG quality 1–100. Ignored for PNG, which is lossless. */
  quality?: number;
  /** Longest width to return; larger images are area-averaged down. */
  maxWidth?: number;
  /** Longest height to return; larger images are area-averaged down. */
  maxHeight?: number;
  /** Ceiling on the total encoded bytes of the response. */
  maxTotalBytes?: number;
}

/** Normalise pdfjs's three decoded shapes into 8-bit samples (#22). */
function toSamples(image: PdfjsImageData): Samples | null {
  // A Uint8ClampedArray may be a view into a larger buffer, so the offset and
  // length have to come along; `new Uint8Array(view.buffer)` would silently
  // read the whole pool.
  const data =
    image.data instanceof Uint8Array
      ? image.data
      : new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  switch (image.kind) {
    case ImageKind.GRAYSCALE_1BPP:
      return expandGrayscale1Bpp(image.width, image.height, data);
    case ImageKind.RGB_24BPP:
      return { width: image.width, height: image.height, channels: 3, data };
    case ImageKind.RGBA_32BPP:
      return { width: image.width, height: image.height, channels: 4, data };
    default:
      // An unrecognised kind means the byte layout is unknown. Encoding it as
      // if it were RGB would produce a picture that is confidently wrong, which
      // is worse than saying the image could not be encoded.
      return null;
  }
}

/**
 * Extract images from the specified pages, encoded as PNG or JPEG files (#22).
 *
 * Previously this base64'd `imgData.data` directly. That buffer is *decoded
 * pixels* — an 8×8 RGB image is 192 bytes with no PNG or JPEG signature — so
 * the result could not be opened by anything, including the vision models the
 * output exists for. Both encoders live in `image-encoder.ts` and add no
 * dependency.
 *
 * Images are returned in page order until `maxTotalBytes` is reached; the rest
 * are reported in `omitted` with the reason. Nothing is dropped silently.
 */
export async function extractImages(
  filePath: string,
  pages?: string,
  options: ExtractImagesOptions = {},
): Promise<ImageExtractionResult> {
  const doc = await loadDocument(filePath);

  const format = options.format ?? 'png';
  const quality = options.quality ?? DEFAULT_IMAGE_QUALITY;
  const budget = options.maxTotalBytes ?? MAX_IMAGE_RESPONSE_BYTES;

  try {
    const pageNumbers = resolvePageNumbers(pages, doc.numPages);

    // Decoding is parallel; the byte budget is spent afterwards, in page order,
    // so which images come back does not depend on which worker finished first.
    const pageResults = await Promise.all(
      pageNumbers.map(async (pageNum) => {
        const page = await doc.getPage(pageNum);
        const opList = await page.getOperatorList();

        const decoded: Array<{ index: number; image: PdfjsImageData }> = [];
        let pageDetected = 0;
        let imageIndex = 0;

        for (let i = 0; i < opList.fnArray.length; i++) {
          const op = opList.fnArray[i];
          if (op === OPS.paintImageXObject) {
            pageDetected++;
            const imgName = opList.argsArray[i][0] as string;
            const imgData = await getImageObject(page, imgName);
            if (imgData?.data) decoded.push({ index: imageIndex, image: imgData });
            imageIndex++;
          }
        }
        return { pageNum, decoded, pageDetected };
      }),
    );

    const images: ExtractedImage[] = [];
    const omitted: OmittedImage[] = [];
    let detectedCount = 0;
    let decodedCount = 0;
    let totalEncodedBytes = 0;

    for (const { pageNum, decoded, pageDetected } of pageResults) {
      detectedCount += pageDetected;
      decodedCount += decoded.length;

      for (const { index, image } of decoded) {
        const { colorSpace, bitsPerComponent } = describeImageKind(image.kind);
        const common = {
          page: pageNum,
          index,
          sourceWidth: image.width,
          sourceHeight: image.height,
        };

        if (image.width * image.height > MAX_IMAGE_PIXELS) {
          omitted.push({
            ...common,
            reason:
              `${image.width}×${image.height} exceeds the ${MAX_IMAGE_PIXELS.toLocaleString()} ` +
              'pixel encoding limit. Pass max_width or max_height to get it at a size that fits.',
          });
          continue;
        }

        const samples = toSamples(image);
        if (!samples) {
          omitted.push({
            ...common,
            reason: `pdfjs reported image kind ${image.kind}, whose byte layout this server does not know`,
          });
          continue;
        }

        const resized = downscale(samples, options.maxWidth, options.maxHeight);
        const encoded =
          format === 'jpeg' ? encodeJpegSamples(resized, quality) : encodePngSamples(resized);

        if (totalEncodedBytes + encoded.bytes.length > budget) {
          omitted.push({
            ...common,
            reason:
              `${encoded.bytes.length.toLocaleString()} bytes would take the response past the ` +
              `${budget.toLocaleString()}-byte image budget. Narrow \`pages\`, or pass ` +
              'max_width / max_height.',
          });
          continue;
        }

        totalEncodedBytes += encoded.bytes.length;
        images.push({
          ...common,
          width: resized.width,
          height: resized.height,
          colorSpace,
          bitsPerComponent,
          mimeType: encoded.mimeType,
          encodedBytes: encoded.bytes.length,
          downscaled: resized.width !== image.width || resized.height !== image.height,
          dataBase64: encoded.bytes.toString('base64'),
        });
      }
    }

    return {
      images,
      detectedCount,
      extractedCount: images.length,
      skippedCount: detectedCount - decodedCount,
      omitted,
      totalEncodedBytes,
    };
  } finally {
    await doc.destroy();
  }
}

function encodePngSamples(samples: Samples): { bytes: Buffer; mimeType: string } {
  const colorType = samples.channels === 4 ? 6 : samples.channels === 3 ? 2 : 0;
  return {
    bytes: encodePng(samples.width, samples.height, colorType, 8, samples.data),
    mimeType: 'image/png',
  };
}

function encodeJpegSamples(samples: Samples, quality: number): { bytes: Buffer; mimeType: string } {
  const opaque = flattenAlphaOverWhite(samples);
  return {
    bytes: encodeJpeg(
      opaque.width,
      opaque.height,
      opaque.channels === 1 ? 1 : 3,
      opaque.data,
      quality,
    ),
    mimeType: 'image/jpeg',
  };
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
  resolution?: ActualTextResolution,
): Promise<PageTextResult> {
  // `includeMarkedContent` is what makes /ActualText resolution possible (#18):
  // the markers say where each marked-content sequence starts and ends, which is
  // what both replacement paths key off. The text items themselves are
  // unaffected by the flag.
  const content = await page.getTextContent({ includeMarkedContent: true });
  const rawItems = content.items as RawTextContentItem[];

  const beginCount = rawItems.filter(
    (item) => item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps',
  ).length;

  let spanActualText: Map<number, string> | undefined;
  let markedContentResolved = true;
  if (resolution?.libDoc) {
    spanActualText = buildSpanActualTextMap(resolution.libDoc, page.pageNumber - 1, beginCount);
    markedContentResolved = spanActualText !== undefined;
  } else {
    markedContentResolved = beginCount === 0;
  }

  const items = foldActualText(
    rawItems,
    resolution?.structActualText ?? EMPTY_ACTUAL_TEXT,
    spanActualText,
  );

  if (items.length === 0) return { text: '', markedContentResolved };

  const splitColumns = options.splitColumns ?? 1;

  if (splitColumns >= 2) {
    // pdfjs-dist returns each page's `view` as [x1, y1, x2, y2] in user space.
    // For most documents the X range starts at 0, so x2 = page width.
    const view = page.view;
    const pageWidth = view[2] - view[0];
    const colWidth = pageWidth / splitColumns;

    const buckets: PositionedText[][] = Array.from({ length: splitColumns }, () => []);
    for (const item of items) {
      const x = item.transform[4] - view[0];
      const colIdx = Math.min(Math.max(0, Math.floor(x / colWidth)), splitColumns - 1);
      buckets[colIdx].push(item);
    }

    const columnTexts = buckets.map((bucket) => itemsToText(bucket, options));
    return {
      text: columnTexts.filter((s) => s.length > 0).join('\n\n'),
      markedContentResolved,
    };
  }

  return { text: itemsToText(items, options), markedContentResolved };
}

/** No structure-element replacements — shared so the empty case allocates nothing. */
const EMPTY_ACTUAL_TEXT: ReadonlyMap<string, string> = new Map();

/**
 * Reorder a flat list of TextItems by Y descending, then X ascending,
 * grouping into lines by Y proximity. Extracted from `extractPageText` so
 * the column-aware path can reuse the same line-grouping logic per bucket.
 *
 * If `options.compactWhitespace` is true, the assembled text passes through
 * `compactRuns` as a final step.
 */
function itemsToText(items: PositionedText[], options: ExtractTextOptions = {}): string {
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
  const lines: PositionedText[][] = [];
  let currentLine: PositionedText[] = [];
  let lastY = sorted[0].transform[5];

  for (const item of sorted) {
    const y = item.transform[5];
    // ISO 32000-2 §14.9.4: consecutive sequences that each carry /ActualText
    // "shall be treated as if no word break is present between them" — and a
    // line break is a word break. This is the hyphenation case the clause's
    // EXAMPLE is about, where the two halves are on different lines by
    // construction, so the Y grouping has to yield to the requirement.
    const weldToPrevious =
      item.replacement?.adjacentToPrevious === true &&
      currentLine.at(-1)?.replacement !== undefined;

    if (!weldToPrevious && Math.abs(y - lastY) > 2 && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = [];
    }
    currentLine.push(item);
    if (!weldToPrevious) lastY = y;
  }

  if (currentLine.length > 0) lines.push(currentLine);

  const text = lines.map(joinLine).join('\n');
  return options.compactWhitespace ? compactRuns(text) : text;
}

/** Join one line's items, deciding each boundary with `separatorBefore`. */
function joinLine(line: PositionedText[]): string {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    if (i > 0) out += separatorBefore(line[i - 1], line[i]);
    out += line[i].str;
  }
  return out;
}

/**
 * Decide what goes between two items of the same line.
 *
 * The default is a space, which is what this extractor has always done: pdfjs
 * splits a line into items at every state change, and for ordinary prose those
 * boundaries usually are word boundaries.
 *
 * `/ActualText` is the exception, and §14.9.4 says why: the value "is a
 * **character** substitution for the content enclosed", not a word or phrase
 * substitution (NOTE 2 draws exactly this contrast with `Alt`). A `BDC` … `EMC`
 * pair forces pdfjs to flush the current item, so a replacement is *always*
 * split from its neighbours even mid-word — the clause's own EXAMPLE, `(Dru) Tj
 * /Span <</ActualText (c)>> BDC (k-) Tj EMC (ker) Tj`, is three items that must
 * read `Drucker`. A space there would be one this extractor invented.
 *
 * So a boundary involving a replacement drops the space when the two items are
 * geometrically flush, and two consecutive replacements drop it unconditionally
 * (that is the "no word break" requirement, which does not depend on geometry).
 */
function separatorBefore(previous: PositionedText, current: PositionedText): string {
  if (current.replacement?.adjacentToPrevious && previous.replacement) return '';
  if ((previous.replacement || current.replacement) && isFlush(previous, current)) return '';
  return ' ';
}

/**
 * Whether `current` starts where `previous` ends, within a quarter of the line
 * height. The tolerance absorbs kerning and the rounding in the item widths
 * pdfjs reports; a real inter-word space is far wider.
 */
function isFlush(previous: PositionedText, current: PositionedText): boolean {
  const end = previous.transform[4] + previous.width;
  const start = current.transform[4];
  const tolerance = 0.25 * Math.max(previous.height, current.height, 1);
  return start >= previous.transform[4] && start - end <= tolerance;
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
 * Was used by search_text to explain empty results on tagged documents (#15).
 * Since #18 resolves `/ActualText` on both of its paths, an empty result no
 * longer implies replacement text was missed, and the warning is keyed off the
 * pages where resolution was actually skipped instead. Kept as a public probe:
 * `get_metadata` reports the same flag, and the tests assert it.
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

// ─── Marked content → drawing rectangle (Issue #20, stage 2) ────────────────

/** An axis-aligned rectangle accumulated in default user space. */
export interface RunBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** What a marked-content sequence's text occupies, and what could not be measured. */
export interface MarkedContentExtent {
  /** null when nothing measurable was found inside the sequence. */
  box: RunBox | null;
  /**
   * True when a run in vertical writing mode was seen. Vertical runs are NOT
   * folded into `box` — pdfjs reports the advance in `height` rather than
   * `width` for them, and guessing which way the glyphs grow would produce a
   * rectangle that is wrong rather than absent. The flag makes the caller
   * suppress the box instead of returning a silently shrunken one.
   */
  hasUnmeasurableRun: boolean;
}

/** A `getTextContent` item, with the geometry fields this module needs. */
interface PositionedTextItem extends TextContentItemLike {
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
}

/** `styles` from `getTextContent`: font metrics, normalised to the em square. */
export interface TextStyleLike {
  ascent?: number;
  descent?: number;
  vertical?: boolean;
}

/** Default em-square ascent/descent, used when pdfjs reports none for a font. */
const FALLBACK_ASCENT = 0.75;
const FALLBACK_DESCENT = -0.25;

/**
 * The rectangle one text run occupies, in default user space.
 *
 * `item.transform` is the run's mapping from em units to user space — §9.4.4's
 * Trm without the device transform, so its translation is the baseline origin
 * and its linear part carries font size, horizontal scaling and any rotation.
 * Measured against pdfjs-dist 4.10: text drawn at 45° reports
 * `[14.14, 14.14, -14.14, 14.14, x, y]` for a 20 pt font, i.e. `|(a,b)| = 20`.
 *
 * So the box is built along the run's own axes rather than the page's:
 *
 *  - **u** = `(a,b)` normalised — the baseline direction; the run extends
 *    `item.width` along it (pdfjs reports the advance already in user space).
 *  - **v** = `(c,d)` normalised — the up direction; the run extends from
 *    `descent × height` to `ascent × height` along it.
 *
 * The vertical extent therefore comes from the font's ascent/descent, not from
 * glyph outlines: a glyph that overshoots its ascent (an accent, a swash) can
 * exceed this rectangle. It is the line box, measured, not the ink.
 */
function runBox(item: PositionedTextItem, style: TextStyleLike | undefined): RunBox | null {
  const t = item.transform;
  if (!t || t.length < 6 || t.some((v) => !Number.isFinite(v))) return null;

  const width = item.width ?? 0;
  const height = item.height ?? 0;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;

  const [a, b, c, d, e, f] = t;
  const baselineLength = Math.hypot(a, b);
  const upLength = Math.hypot(c, d);
  // A degenerate matrix draws nothing measurable; a zero-height run is a pdfjs
  // spacing artefact (str: " " with height 0), not visible content.
  if (baselineLength === 0 || upLength === 0 || height === 0) return null;

  const ux = a / baselineLength;
  const uy = b / baselineLength;
  const vx = c / upLength;
  const vy = d / upLength;

  const ascent = style?.ascent ?? FALLBACK_ASCENT;
  const descent = style?.descent ?? FALLBACK_DESCENT;
  const top = ascent * height;
  const bottom = descent * height;

  const xs: number[] = [];
  const ys: number[] = [];
  for (const along of [0, width]) {
    for (const up of [bottom, top]) {
      xs.push(e + ux * along + vx * up);
      ys.push(f + uy * along + vy * up);
    }
  }

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function mergeBox(into: RunBox | null, add: RunBox): RunBox {
  if (!into) return { ...add };
  return {
    minX: Math.min(into.minX, add.minX),
    minY: Math.min(into.minY, add.minY),
    maxX: Math.max(into.maxX, add.maxX),
    maxY: Math.max(into.maxY, add.maxY),
  };
}

/**
 * Build a map from a marked-content `id` to the rectangle its text occupies.
 *
 * The same walk as `buildIdToTextMap`, and deliberately the same skips, so that
 * "the text of this element" and "where that text is" cannot disagree: nested
 * sequences count toward every active id, and `Artifact` sequences are excluded
 * (§14.8.2.5 NOTE 3 puts artifacts outside the logical content order).
 *
 * Two further exclusions belong to geometry rather than text:
 *
 *  - **Whitespace-only runs.** Table 379 defines `BBox` as the rectangle that
 *    "completely encloses its **visible** content", and a run of spaces is not
 *    visible. pdfjs does emit wide ones for inter-cell gaps: measured on
 *    `spanning-table.pdf`, a `TH` carries a 75 pt run of spaces that reaches
 *    into the neighbouring column. That particular one arrives with
 *    `height: 0` and `runBox` rejects it on those grounds alone; this check is
 *    what covers a spacer that comes with a height.
 *  - **EOL markers** (`str: ''`, `hasEOL: true`), which carry no geometry.
 */
export function buildIdToBoxMap(
  items: PositionedTextItem[],
  styles: Record<string, TextStyleLike> = {},
): Map<string, MarkedContentExtent> {
  const map = new Map<string, MarkedContentExtent>();
  const stack: { id: string | null; isArtifact: boolean }[] = [];

  const touch = (id: string): MarkedContentExtent => {
    const existing = map.get(id);
    if (existing) return existing;
    const created: MarkedContentExtent = { box: null, hasUnmeasurableRun: false };
    map.set(id, created);
    return created;
  };

  for (const item of items) {
    const t = item.type;
    if (t === 'beginMarkedContent' || t === 'beginMarkedContentProps') {
      stack.push({ id: item.id ?? null, isArtifact: item.tag === 'Artifact' });
      continue;
    }
    if (t === 'endMarkedContent') {
      stack.pop();
      continue;
    }
    if (t !== undefined) continue; // unknown marker
    if (stack.some((s) => s.isArtifact)) continue;
    if (item.hasEOL) continue;
    const str = item.str ?? '';
    if (str.trim() === '') continue;

    const style = item.fontName ? styles[item.fontName] : undefined;
    if (style?.vertical) {
      for (const frame of stack) {
        if (frame.id) touch(frame.id).hasUnmeasurableRun = true;
      }
      continue;
    }

    const box = runBox(item, style);
    if (!box) continue;
    for (const frame of stack) {
      if (frame.id) {
        const extent = touch(frame.id);
        extent.box = mergeBox(extent.box, box);
      }
    }
  }

  return map;
}

/**
 * Build the marked-content id → rectangle map across the whole document.
 *
 * Document-wide for the same reason as `buildDocumentIdToTextMap`: a structure
 * element can own content on several pages (§14.8.2.5 NOTE 2), and the ids are
 * globally unique because pdfjs builds them from the page object number.
 */
export async function buildDocumentIdToBoxMap(
  doc: PDFDocumentProxy,
): Promise<Map<string, MarkedContentExtent>> {
  const perPage = await Promise.all(
    Array.from({ length: doc.numPages }, async (_, i) => {
      const page = await doc.getPage(i + 1);
      const content = await page.getTextContent({ includeMarkedContent: true });
      return buildIdToBoxMap(
        content.items as PositionedTextItem[],
        content.styles as Record<string, TextStyleLike>,
      );
    }),
  );

  const merged = new Map<string, MarkedContentExtent>();
  for (const map of perPage) {
    for (const [id, extent] of map) merged.set(id, extent);
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
