/**
 * Text extractability observation (#21).
 *
 * `read_text` used to answer with text or with nothing, and nothing meant three
 * different things. ISO 32000-2 §9.10.1 separates them: text can be absent, or
 * present as glyphs that no method in §9.10.2 converts to Unicode, or present
 * and convertible. This service reports which of those a page is in, and — when
 * conversion is not available — which fonts are the reason.
 *
 * It reads the file, not pdfjs's output. That matters: pdfjs synthesises a
 * `toUnicode` map for every font it loads (a standard-encoding font gets one
 * built from the encoding), so asking pdfjs "does this font have a ToUnicode
 * CMap?" answers yes for fonts whose dictionary has no `/ToUnicode` at all. The
 * question §9.10.1 asks is about the file.
 *
 * What it does NOT do: judge. `not_extractable` says the file offers no route
 * from these character codes to Unicode — not that the document is wrong, and
 * not that the text pdfjs did return is worthless. The caller decides.
 */

import type { PDFDocument } from 'pdf-lib';
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFStream, PDFString } from 'pdf-lib';
import type { PageExtractability, UnmappableFont } from '../types.js';
import { resolvePageNumbers } from '../utils/pdf-helpers.js';
import { scanPageTextOperators } from './content-stream-service.js';
import { loadWithPdfLib, loadWithPdfLibFromData } from './pdflib-service.js';

/**
 * Character collections §9.10.2 names as reachable, via the
 * `registry–ordering–UCS2` CMap it tells the processor to construct.
 *
 * `Identity` is deliberately absent: an Adobe-Identity-0 CIDFont has no such
 * CMap, which is exactly why Identity-H without `/ToUnicode` is the common
 * unreadable case.
 */
const MAPPABLE_CID_ORDERINGS: ReadonlySet<string> = new Set([
  'GB1',
  'CNS1',
  'Japan1',
  'Korea1',
  'KR',
]);

/** The two CMap names §9.10.2 excludes from its composite-font rule. */
const IDENTITY_CMAPS: ReadonlySet<string> = new Set(['Identity-H', 'Identity-V']);

/** Named encodings §9.6.5.4 accepts for the glyph-name path of a TrueType font. */
const TRUETYPE_NAMED_ENCODINGS: ReadonlySet<string> = new Set([
  'MacRomanEncoding',
  'WinAnsiEncoding',
]);

/** "Table 121 — Font flags": bit 3 (value 4) Symbolic, bit 6 (value 32) Nonsymbolic. */
const FLAG_SYMBOLIC = 1 << 2;
const FLAG_NONSYMBOLIC = 1 << 5;

/** The verdict for one font, with the clause it comes from. */
interface FontVerdict {
  mappable: boolean;
  reason: string;
}

function deref(doc: PDFDocument, value: unknown): unknown {
  return value instanceof PDFRef ? doc.context.lookup(value) : value;
}

function nameOf(doc: PDFDocument, dict: PDFDict, key: string): string | null {
  const value = deref(doc, dict.get(PDFName.of(key)));
  return value instanceof PDFName ? value.decodeText() : null;
}

/** The descendant CIDFont of a Type0 font (Table 119; the array may be indirect). */
function descendantFont(doc: PDFDocument, font: PDFDict): PDFDict | null {
  const descendants = deref(doc, font.get(PDFName.of('DescendantFonts')));
  if (!(descendants instanceof PDFArray) || descendants.size() === 0) return null;
  const first = deref(doc, descendants.get(0));
  return first instanceof PDFDict ? first : null;
}

/** `/CIDSystemInfo /Ordering` of a CIDFont, e.g. `Japan1` (Table 115). */
function cidOrdering(doc: PDFDocument, cidFont: PDFDict): string | null {
  const info = deref(doc, cidFont.get(PDFName.of('CIDSystemInfo')));
  if (!(info instanceof PDFDict)) return null;
  const ordering = deref(doc, info.get(PDFName.of('Ordering')));
  if (ordering instanceof PDFString) return ordering.decodeText();
  return null;
}

/** `/Flags` of the font descriptor, or `null` when there is no descriptor. */
function descriptorFlags(doc: PDFDocument, font: PDFDict): number | null {
  const descriptor = deref(doc, font.get(PDFName.of('FontDescriptor')));
  if (!(descriptor instanceof PDFDict)) return null;
  const flags = deref(doc, descriptor.get(PDFName.of('Flags')));
  return flags instanceof PDFNumber ? flags.asNumber() : null;
}

/**
 * Decide whether §9.10.2 offers any route from this font's character codes to
 * Unicode, in the priority the clause gives.
 */
function classifyFont(doc: PDFDocument, font: PDFDict | null): FontVerdict {
  if (!font) {
    return {
      mappable: false,
      reason: 'the /Tf name resolves to no font dictionary in /Resources /Font',
    };
  }

  // §9.10.2, first method — a /ToUnicode CMap outranks everything else.
  const toUnicode = deref(doc, font.get(PDFName.of('ToUnicode')));
  if (toUnicode instanceof PDFStream) {
    return { mappable: true, reason: 'has a /ToUnicode CMap (§9.10.2, first method)' };
  }

  const subtype = nameOf(doc, font, 'Subtype');

  if (subtype === 'Type0') {
    // §9.10.2, third method — a predefined CJK CMap other than Identity-H/V, or
    // a descendant CIDFont in one of the named character collections.
    const encoding = nameOf(doc, font, 'Encoding');
    if (encoding && !IDENTITY_CMAPS.has(encoding)) {
      return {
        mappable: true,
        reason: `predefined CMap /${encoding} (§9.10.2, third method)`,
      };
    }
    const cidFont = descendantFont(doc, font);
    if (!cidFont) {
      return {
        mappable: false,
        reason: 'Type0 without /DescendantFonts, so no character collection to map through',
      };
    }
    const ordering = cidOrdering(doc, cidFont);
    if (ordering && MAPPABLE_CID_ORDERINGS.has(ordering)) {
      return {
        mappable: true,
        reason: `descendant CIDFont in the Adobe-${ordering} collection (§9.10.2, third method)`,
      };
    }
    return {
      mappable: false,
      reason:
        `${encoding ?? 'an embedded CMap'} with /Ordering ${ordering ?? '(absent)'} and ` +
        'no /ToUnicode — §9.10.2 names no CMap that converts these CIDs',
    };
  }

  if (subtype === 'TrueType') {
    // §9.6.5.4: glyph *names* exist only on the MacRoman/WinAnsi or nonsymbolic
    // path; otherwise selection goes straight through the font program's "cmap"
    // and §9.10.2's second method has no name to look up in the AGL.
    const flags = descriptorFlags(doc, font);
    const encoding = nameOf(doc, font, 'Encoding');
    const symbolic = flags !== null && (flags & FLAG_SYMBOLIC) !== 0;
    const nonsymbolic = flags !== null && (flags & FLAG_NONSYMBOLIC) !== 0;
    if (nonsymbolic || (!symbolic && encoding && TRUETYPE_NAMED_ENCODINGS.has(encoding))) {
      return {
        mappable: true,
        reason: 'glyph names via the Adobe Glyph List (§9.10.2, second method)',
      };
    }
    if (!symbolic && deref(doc, font.get(PDFName.of('Encoding'))) instanceof PDFDict) {
      return {
        mappable: true,
        reason: 'glyph names from the /Encoding dictionary (§9.6.5.4, §9.10.2 second method)',
      };
    }
    return {
      mappable: false,
      reason:
        'symbolic TrueType with no MacRoman/WinAnsi encoding — §9.6.5.4 selects glyphs ' +
        'through the font program’s "cmap", so there is no glyph name to look up',
    };
  }

  if (subtype === 'Type1' || subtype === 'MMType1' || subtype === 'Type3') {
    return {
      mappable: true,
      reason: `${subtype} selects glyphs by name (§9.6.5), so §9.10.2's second method applies`,
    };
  }

  return {
    mappable: false,
    reason: `/Subtype ${subtype ?? '(absent)'} is not one this server knows how to map`,
  };
}

function describeFont(
  doc: PDFDocument,
  resourceName: string,
  font: PDFDict | null,
  reason: string,
): UnmappableFont {
  return {
    resourceName,
    baseFont: font ? nameOf(doc, font, 'BaseFont') : null,
    subtype: font ? nameOf(doc, font, 'Subtype') : null,
    encoding: font ? nameOf(doc, font, 'Encoding') : null,
    reason,
  };
}

/** Observe one page. `pageIndex` is 0-based; the reported `page` is 1-based. */
function observePage(doc: PDFDocument, pageIndex: number): PageExtractability {
  const page = pageIndex + 1;
  const scanned = scanPageTextOperators(doc, pageIndex);

  if (!scanned) {
    return {
      page,
      state: 'not_observed',
      unmappableFonts: [],
      fontsUsed: 0,
      textShowingOperators: 0,
      imageOperators: 0,
      actualTextEntries: 0,
      reason: doc.isEncrypted
        ? 'the document is encrypted, so its content streams could not be read here'
        : 'the page has no readable content stream',
    };
  }

  const { tally, actualTextEntries } = scanned;
  const base = {
    page,
    unmappableFonts: [] as UnmappableFont[],
    fontsUsed: tally.usedFonts.size,
    textShowingOperators: tally.textShowingOperators,
    imageOperators: tally.imageOperators,
    actualTextEntries,
  };

  if (tally.textShowingOperators === 0) {
    // No `Tj`/`TJ`/`'`/`"` at all. With image content on the page that is the
    // scanned-page shape; without it the page really is blank. Reporting both
    // as an empty string was the bug.
    return { ...base, state: tally.imageOperators > 0 ? 'no_text_layer' : 'extracted' };
  }

  const unmappable: UnmappableFont[] = [];
  for (const [resourceName, font] of tally.usedFonts) {
    const verdict = classifyFont(doc, font);
    if (!verdict.mappable) unmappable.push(describeFont(doc, resourceName, font, verdict.reason));
  }

  if (unmappable.length === 0) return { ...base, state: 'extracted' };
  return { ...base, state: 'not_extractable', unmappableFonts: unmappable };
}

function observeDocument(doc: PDFDocument, pages?: string): PageExtractability[] {
  const pageNumbers = resolvePageNumbers(pages, doc.getPageCount());
  return pageNumbers.map((pageNumber) => observePage(doc, pageNumber - 1));
}

/** Observe the pages of a PDF on disk. */
export async function observeExtractability(
  filePath: string,
  pages?: string,
): Promise<PageExtractability[]> {
  return observeDocument(await loadWithPdfLib(filePath), pages);
}

/** The same, for bytes already in hand (`read_url`). */
export async function observeExtractabilityFromData(
  data: Uint8Array,
  pages?: string,
): Promise<PageExtractability[]> {
  return observeDocument(await loadWithPdfLibFromData(data), pages);
}

/**
 * Fold per-page states into one document-level answer for `summarize`.
 *
 * The order is deliberate: anything unreadable outranks everything readable, so
 * a 200-page report with one unmappable page does not summarise as `extracted`.
 */
export function foldExtractability(pages: PageExtractability[]): PageExtractability['state'] {
  if (pages.length === 0) return 'not_observed';
  if (pages.some((p) => p.state === 'not_extractable')) return 'not_extractable';
  if (pages.some((p) => p.state === 'no_text_layer')) return 'no_text_layer';
  if (pages.some((p) => p.state === 'extracted')) return 'extracted';
  return 'not_observed';
}

/** One line a caller can print without knowing the shape of the record. */
export function describeExtractability(observation: PageExtractability): string {
  switch (observation.state) {
    case 'extracted':
      return observation.textShowingOperators === 0
        ? 'extracted — the page shows no text and none is missing'
        : 'extracted — every font used here has a route to Unicode (ISO 32000-2 §9.10.2)';
    case 'no_text_layer':
      return (
        `no_text_layer — no text-showing operator, ${observation.imageOperators} image(s) drawn. ` +
        'Reading this page needs OCR or a rendered image; this server does neither.'
      );
    case 'not_extractable': {
      const names = observation.unmappableFonts
        .map((f) => f.baseFont ?? `/${f.resourceName}`)
        .join(', ');
      const partial = observation.unmappableFonts.length < observation.fontsUsed;
      const scope = partial
        ? `${observation.unmappableFonts.length} of ${observation.fontsUsed} fonts on this page`
        : 'every font on this page';
      const actualText =
        observation.actualTextEntries > 0
          ? ` The page carries ${observation.actualTextEntries} /ActualText entr${
              observation.actualTextEntries === 1 ? 'y' : 'ies'
            }, which may cover some or all of it (§14.9.4).`
          : '';
      return (
        `not_extractable — ${scope} (${names}): no method in ISO 32000-2 §9.10.2 converts ` +
        `their character codes to Unicode, so what they show is missing or wrong in the ` +
        `extracted text.${actualText}`
      );
    }
    case 'not_observed':
      return `not_observed — ${observation.reason ?? 'the page could not be examined'}`;
  }
}

/**
 * The banner every text-returning tool puts above its output.
 *
 * It is printed even when everything is `extracted` — a state that only appears
 * when something is wrong is a state the caller learns to ignore, and #21 is
 * about output that looked complete when it was not.
 */
export function summarizeExtractability(pages: PageExtractability[]): string[] {
  if (pages.length === 0) return [];

  const counts = new Map<PageExtractability['state'], number>();
  for (const p of pages) counts.set(p.state, (counts.get(p.state) ?? 0) + 1);
  const tally = [...counts.entries()].map(([state, n]) => `${state} ${n}`).join(', ');

  const lines = [`> Text extractability (ISO 32000-2 §9.10.1): ${tally}`];
  for (const p of pages) {
    if (p.state === 'extracted') continue;
    lines.push(`> - page ${p.page}: ${describeExtractability(p)}`);
  }
  return lines;
}

/** Index an observation list by page number, for merging into per-page output. */
export function byPage(pages: PageExtractability[]): Map<number, PageExtractability> {
  return new Map(pages.map((p) => [p.page, p]));
}
