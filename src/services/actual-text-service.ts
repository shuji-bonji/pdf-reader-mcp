/**
 * `/ActualText` resolution for coordinate-order text extraction (#18).
 *
 * ISO 32000-2 §14.9.4:
 *
 * > The ActualText value **shall** be used as a **replacement, not a
 * > description**, for the content, providing text that is equivalent to what a
 * > person would see when viewing the content. The value of ActualText is a
 * > character substitution for the content enclosed by the structure element or
 * > marked-content sequence.
 *
 * A text-extracting tool that ignores it therefore returns text that is *not*
 * equivalent to what a person sees — which is what #15 documented and #18 fixes.
 *
 * Replacement text lives in two places, and this module resolves both:
 *
 *  1. **structure element** `/ActualText` (PDF 1.4) — found by walking
 *     `StructTreeRoot` and mapping the element's marked-content references
 *     (`/Pg` + `/MCID`) onto the MCIDs pdfjs reports;
 *  2. **marked-content sequence** `/ActualText` (PDF 1.5, a `Span` property
 *     list) — found by scanning the content stream, because pdfjs drops
 *     property lists (see `content-stream-service`). This one occurs in
 *     **untagged** documents too, so path 1 alone cannot reach it.
 *
 * ## How the two streams are aligned
 *
 * The scanner records `BMC` / `BDC` / `EMC` in content-stream order; pdfjs emits
 * one marker per such operator, in the same order. So the *n*-th begin marker
 * from pdfjs is the *n*-th begin event from the scan — no coordinate matching.
 * When the two disagree on how many there are, the alignment is unknown and
 * path 2 is abandoned for that page (path 1 is unaffected: it keys off MCIDs
 * pdfjs supplies itself). Returning raw glyphs is the old, documented
 * behaviour; attaching replacement text to the wrong glyphs would be new damage.
 */

import type { PDFDocument as PdfLibDocument } from 'pdf-lib';
import { scanPageMarkedContent } from './content-stream-service.js';
import type { StructElement } from './struct-tree-walker.js';
import { collectContentRefs, walkStructTree } from './struct-tree-walker.js';

/** A pdfjs text item, reduced to what reading order and joining need. */
export interface PositionedText {
  str: string;
  /** `[a, b, c, d, e, f]` — `e`/`f` are the X/Y of the item's origin. */
  transform: number[];
  width: number;
  height: number;
  /**
   * Set when this item is `/ActualText` standing in for the glyphs it replaced.
   * `adjacentToPrevious` records that the sequence it came from directly
   * followed another one that also had `/ActualText`, which is the condition
   * §14.9.4's "no word break" requirement turns on — and which is no longer
   * recoverable once the items have been sorted into reading order.
   */
  replacement?: { adjacentToPrevious: boolean };
}

/** A pdfjs `getTextContent({ includeMarkedContent: true })` item. */
interface RawItem {
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
 * Map every MCID that a structure element with `/ActualText` owns to that text.
 *
 * The element's replacement covers everything it encloses, descendants
 * included, so the walk stops descending once it finds an `/ActualText`: an
 * inner one would be substituting for content the outer one has already
 * replaced. Keyed by pdfjs's marked-content id (`p7R_mc3`) so no page bookkeeping
 * is needed at lookup time.
 */
export function buildStructActualTextMap(doc: PdfLibDocument): Map<string, string> {
  const map = new Map<string, string>();
  const roots = walkStructTree(doc);
  if (!roots) return map;

  const visit = (element: StructElement): void => {
    if (element.actualText !== null) {
      const refs = collectContentRefs(element);
      for (const ref of refs) {
        map.set(`p${ref.pageObjNum}R_mc${ref.mcid}`, element.actualText);
      }
      // Do not descend: the whole subtree is what this text replaces.
      return;
    }
    for (const child of element.children) visit(child);
  };
  for (const root of roots) visit(root);
  return map;
}

/**
 * Fold a page's pdfjs items into positioned text, substituting `/ActualText`.
 *
 * A replaced region collapses to a single item carrying the replacement string,
 * placed at the first glyph it replaced and as wide as the region — so the
 * caller's Y/X sort still puts it where the reader sees it. A region containing
 * no glyphs at all (replacement text over a Figure, say) inherits the previous
 * item's position, which is the only ordering information available.
 *
 * @param structActualText MCID → replacement, from `buildStructActualTextMap`.
 * @param spanActualText   Begin-marker index → replacement, from the content
 *                         stream scan. Undefined when alignment is unknown.
 */
export function foldActualText(
  rawItems: RawItem[],
  structActualText: ReadonlyMap<string, string>,
  spanActualText: ReadonlyMap<number, string> | undefined,
): PositionedText[] {
  const out: PositionedText[] = [];

  /** How many marked-content sequences are currently open. */
  let depth = 0;
  let beginIndex = -1;

  /** The replacement currently being accumulated, if any. */
  let open: {
    text: string;
    depth: number;
    transform: number[] | null;
    minX: number;
    maxX: number;
    height: number;
  } | null = null;

  /** True while nothing but the closing of a replacement has been emitted. */
  let lastEmittedWasReplacement = false;
  let sawTextSinceReplacement = true;
  let lastTransform: number[] | null = null;
  let lastHeight = 0;

  const closeOpen = (): void => {
    if (!open) return;
    const transform = open.transform ?? lastTransform ?? [1, 0, 0, 1, 0, 0];
    const width = open.transform ? Math.max(0, open.maxX - open.minX) : 0;
    out.push({
      str: open.text,
      transform,
      width,
      height: open.height || lastHeight,
      replacement: {
        // §14.9.4: "If each of two (or more) consecutive structure or
        // marked-content sequences has an ActualText entry, they shall be
        // treated as if no word break is present between them." Consecutive
        // means nothing came between — hence `sawTextSinceReplacement`.
        adjacentToPrevious: lastEmittedWasReplacement && !sawTextSinceReplacement,
      },
    });
    lastEmittedWasReplacement = true;
    sawTextSinceReplacement = false;
    lastTransform = transform;
    open = null;
  };

  for (const item of rawItems) {
    const type = item.type;

    if (type === 'beginMarkedContent' || type === 'beginMarkedContentProps') {
      beginIndex++;
      // Already inside a replacement? The outer one covers this too: §14.9.4
      // makes ActualText a substitution for everything the sequence encloses.
      const replacementText: string | undefined = open
        ? undefined
        : (spanActualText?.get(beginIndex) ??
          (item.id ? structActualText.get(item.id) : undefined));

      if (replacementText !== undefined) {
        open = { text: replacementText, depth, transform: null, minX: 0, maxX: 0, height: 0 };
      }
      depth++;
      continue;
    }

    if (type === 'endMarkedContent') {
      if (depth > 0) depth--;
      if (open && depth === open.depth) closeOpen();
      continue;
    }

    if (type !== undefined) continue; // an unrecognised marker

    // A text item.
    const transform = item.transform;
    const width = item.width ?? 0;
    const height = item.height ?? 0;

    if (open) {
      // Swallowed by the replacement, but its geometry positions it.
      if (transform) {
        if (!open.transform) {
          open.transform = transform;
          open.minX = transform[4];
          open.maxX = transform[4] + width;
          open.height = height;
        } else {
          open.maxX = Math.max(open.maxX, transform[4] + width);
        }
      }
      continue;
    }

    const str = item.hasEOL ? '' : (item.str ?? '');
    if (!transform) continue;
    lastTransform = transform;
    if (height) lastHeight = height;
    if (!str) continue;

    out.push({ str, transform, width, height });
    lastEmittedWasReplacement = false;
    sawTextSinceReplacement = true;
  }

  closeOpen();
  return out;
}

/**
 * Build the `Span`-level replacement map for one page, or `undefined` when the
 * content stream and pdfjs disagree about how many marked-content sequences the
 * page has (see the module comment for why that is fatal to the alignment).
 *
 * @param pageIndex 0-based.
 * @param pdfjsBeginCount How many begin markers pdfjs reported for the page.
 */
export function buildSpanActualTextMap(
  doc: PdfLibDocument,
  pageIndex: number,
  pdfjsBeginCount: number,
): Map<number, string> | undefined {
  const events = scanPageMarkedContent(doc, pageIndex);
  if (!events) return pdfjsBeginCount === 0 ? new Map() : undefined;

  const begins = events.filter((e) => e.kind === 'begin');
  if (begins.length !== pdfjsBeginCount) return undefined;

  const map = new Map<number, string>();
  begins.forEach((event, index) => {
    if (event.actualText !== undefined) map.set(index, event.actualText);
  });
  return map;
}
