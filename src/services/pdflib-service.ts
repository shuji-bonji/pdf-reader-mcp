/**
 * pdf-lib wrapper service.
 *
 * Provides low-level PDF structure access via pdf-lib for Tier 2 tools.
 * Runs alongside pdfjs-service.ts (which handles text/image extraction).
 */

import { open } from 'node:fs/promises';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
} from 'pdf-lib';
import type {
  CatalogEntry,
  FontInfo,
  ObjectStats,
  PageTreeInfo,
  SignatureFieldInfo,
  SignaturesAnalysis,
  StructureAnalysis,
} from '../types.js';
import { readPdfFile } from '../utils/pdf-helpers.js';

/**
 * pdf-lib emits parser diagnostics via `console.log` (not `console.warn`),
 * which on stdio MCP servers pollutes the JSON-RPC stream. Wrap any pdf-lib
 * call site with this to silence those warnings without losing real errors.
 */
async function withSuppressedPdfLibLogs<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
  }
}

/**
 * Load a PDF document with pdf-lib.
 *
 * Uses `throwOnInvalidObject: false` so that Linearized PDFs (whose hint
 * streams cannot be resolved by pdf-lib) still load instead of throwing.
 * The actual page-tree access may still throw — see `trySilently` below.
 */
export async function loadWithPdfLib(filePath: string): Promise<PDFDocument> {
  const data = await readPdfFile(filePath);
  return withSuppressedPdfLibLogs(() =>
    PDFDocument.load(data, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    }),
  );
}

/**
 * Try `fn()`, swallowing pdf-lib parse errors and pdf-lib's own
 * `console.log` chatter. Returns `undefined` on failure.
 *
 * Used to make best-effort calls against documents whose cross-reference
 * tables are partially unresolvable (Linearized PDFs are the typical case —
 * pdf-lib cannot follow `/Linearized` hint streams, so `getPages()` and
 * similar accessors throw `Expected instance of PDFDict, but got undefined`).
 */
function trySilently<T>(fn: () => T): T | undefined {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return fn();
  } catch {
    return undefined;
  } finally {
    console.log = originalLog;
  }
}

/**
 * Check if a PDF is encrypted.
 */
export async function detectEncryption(filePath: string): Promise<boolean> {
  try {
    const data = await readPdfFile(filePath);
    const doc = await withSuppressedPdfLibLogs(() =>
      PDFDocument.load(data, {
        ignoreEncryption: true,
        updateMetadata: false,
      }),
    );
    return doc.isEncrypted;
  } catch {
    return false;
  }
}

/**
 * Analyze PDF internal structure (catalog, page tree, objects).
 *
 * Linearized PDFs (typical of public-sector publishers) confuse pdf-lib's
 * cross-reference resolver, so `getPages()` and `getPageCount()` throw
 * `Expected instance of PDFDict, but got instance of undefined`. We catch
 * those failures, fall back to pdfjs-dist for the page count, and attach
 * a `note` describing the partial result. The catalog walk and object
 * enumeration still work in this state, so the user gets meaningful output
 * instead of a hard error.
 */
export async function analyzeStructure(filePath: string): Promise<StructureAnalysis> {
  return withSuppressedPdfLibLogs(() => analyzeStructureImpl(filePath));
}

async function analyzeStructureImpl(filePath: string): Promise<StructureAnalysis> {
  const doc = await loadWithPdfLib(filePath);
  const catalog = doc.catalog;
  const context = doc.context;

  // Extract catalog entries (best-effort: tolerate per-entry failures)
  const catalogEntries: CatalogEntry[] = [];
  try {
    for (const [key, value] of catalog.entries()) {
      catalogEntries.push({
        key: key.decodeText(),
        type: value.constructor.name,
        value: summarizeObject(value),
      });
    }
  } catch {
    // catalog.entries() should rarely throw, but keep the partial list
  }

  // Page tree info (best-effort — fall back to pdfjs-dist for Linearized PDFs)
  let totalPages = trySilently(() => doc.getPageCount()) ?? 0;
  const pages = trySilently(() => doc.getPages()) ?? [];
  const maxSamples = Math.min(pages.length, 5);
  const mediaBoxSamples: PageTreeInfo['mediaBoxSamples'] = [];
  for (let i = 0; i < maxSamples; i++) {
    const box = trySilently(() => pages[i].getMediaBox());
    if (!box) continue;
    mediaBoxSamples.push({
      page: i + 1,
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
    });
  }

  let note: string | undefined;
  if (totalPages === 0 && pages.length === 0) {
    // pdf-lib couldn't traverse the page tree — try pdfjs-dist as fallback.
    try {
      const { loadDocument } = await import('./pdfjs-service.js');
      const pdfjsDoc = await loadDocument(filePath);
      try {
        totalPages = pdfjsDoc.numPages;
        note =
          'pdf-lib could not fully resolve the page tree (typical of Linearized PDFs); ' +
          'totalPages was obtained via pdfjs-dist. mediaBox samples are unavailable.';
      } finally {
        await pdfjsDoc.destroy();
      }
    } catch {
      // Even pdfjs failed — keep totalPages = 0
      note = 'Page tree could not be resolved by either pdf-lib or pdfjs-dist.';
    }
  }

  const pageTree: PageTreeInfo = {
    totalPages,
    mediaBoxSamples,
  };

  // Object statistics (best-effort)
  const byType: Record<string, number> = {};
  let streamCount = 0;
  let totalObjects = 0;
  const allObjects = trySilently(() => context.enumerateIndirectObjects()) ?? [];
  for (const [_ref, obj] of allObjects) {
    const typeName = obj.constructor.name;
    byType[typeName] = (byType[typeName] ?? 0) + 1;
    if (obj instanceof PDFStream) {
      streamCount++;
    }
  }
  totalObjects = allObjects.length;

  const objectStats: ObjectStats = {
    totalObjects,
    streamCount,
    byType,
  };

  // PDF version: the LATER of the file header and the catalog's /Version.
  // Table 29 does not let the catalog simply win — see resolvePdfVersion.
  // The catalog entry "shall be a name object, not a number", hence PDFName.
  const headerVersion = await readHeaderVersion(filePath);
  const catalogVersion =
    trySilently(() => catalog.lookupMaybe(PDFName.of('Version'), PDFName))?.decodeText() ?? null;
  const pdfVersion = resolvePdfVersion(headerVersion, catalogVersion);

  const result: StructureAnalysis = {
    catalog: catalogEntries,
    pageTree,
    objectStats,
    isEncrypted: doc.isEncrypted,
    pdfVersion,
  };
  if (note) result.note = note;
  return result;
}

/** Font analysis result including font map and total pages scanned */
export interface FontAnalysisResult {
  fontMap: Map<string, FontInfo>;
  pagesScanned: number;
  /**
   * Optional human-readable note describing partial / fallback results.
   * Set when the page tree could not be enumerated (Linearized PDFs).
   */
  note?: string;
}

/**
 * Analyze fonts across all pages using pdf-lib's low-level access.
 * Returns font map and total pages scanned.
 *
 * Linearized PDFs cannot have their page tree enumerated by pdf-lib — instead
 * of throwing, we return an empty font map with `note` describing the limitation,
 * so that the caller can still produce a useful response.
 */
export async function analyzeFontsWithPdfLib(filePath: string): Promise<FontAnalysisResult> {
  return withSuppressedPdfLibLogs(() => analyzeFontsWithPdfLibImpl(filePath));
}

async function analyzeFontsWithPdfLibImpl(filePath: string): Promise<FontAnalysisResult> {
  const doc = await loadWithPdfLib(filePath);
  const fontMap = new Map<string, FontInfo>();
  const pages = trySilently(() => doc.getPages()) ?? [];

  if (pages.length === 0) {
    return {
      fontMap,
      pagesScanned: 0,
      note:
        'pdf-lib could not enumerate the page tree (typical of Linearized PDFs); ' +
        'fonts could not be analyzed. Consider regenerating the PDF without linearization.',
    };
  }

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageNum = pageIdx + 1;
    const pageNode = pages[pageIdx].node;
    const resources = trySilently(() => pageNode.Resources());
    if (!resources) continue;

    const fontDict = trySilently(() => resources.lookupMaybe(PDFName.of('Font'), PDFDict));
    if (!fontDict) continue;

    for (const [fontNameObj, fontRefOrDict] of fontDict.entries()) {
      const fontKey = fontNameObj.decodeText();

      // Resolve to actual font dictionary
      let actualFont: PDFDict | undefined;
      if (fontRefOrDict instanceof PDFRef) {
        const resolved = doc.context.lookup(fontRefOrDict);
        if (resolved instanceof PDFDict) {
          actualFont = resolved;
        }
      } else if (fontRefOrDict instanceof PDFDict) {
        actualFont = fontRefOrDict;
      }

      if (!actualFont) continue;

      // Extract font properties
      const subtypeObj = actualFont.lookupMaybe(PDFName.of('Subtype'), PDFName);
      const baseFontObj = actualFont.lookupMaybe(PDFName.of('BaseFont'), PDFName);
      const encodingObj = actualFont.get(PDFName.of('Encoding'));

      const baseFontName = baseFontObj?.decodeText() ?? fontKey;
      const subtype = subtypeObj?.decodeText() ?? 'Unknown';
      const encoding = encodingObj instanceof PDFName ? encodingObj.decodeText() : null;

      // Check if font is embedded (has FontDescriptor with FontFile/FontFile2/FontFile3).
      //
      // For Type 0 (composite) fonts the FontDescriptor is NOT on the font
      // dictionary itself — ISO 32000-2 Table 119 has no such entry. It lives on
      // the CIDFont dictionary in DescendantFonts, where Table 115 marks it
      // "(Required; shall be an indirect reference)". §9.7.6.2 fixes the font
      // number at 0 ("In PDF, the font number shall be 0"), and Table 119
      // describes DescendantFonts as "a one-element array", so element 0 is the
      // only descendant to inspect.
      const descriptorHost =
        subtype === 'Type0' ? resolveDescendantFont(doc, actualFont) : actualFont;
      const isEmbedded = descriptorHost ? hasEmbeddedFontFile(doc, descriptorHost) : false;

      // Check if subset (name starts with 6 uppercase + '+')
      const isSubset = /^[A-Z]{6}\+/.test(baseFontName);

      const existing = fontMap.get(baseFontName);
      if (existing) {
        if (!existing.pagesUsed.includes(pageNum)) {
          existing.pagesUsed.push(pageNum);
        }
      } else {
        fontMap.set(baseFontName, {
          name: baseFontName,
          type: subtype,
          encoding,
          isEmbedded,
          isSubset,
          pagesUsed: [pageNum],
        });
      }
    }
  }

  return { fontMap, pagesScanned: pages.length };
}

/**
 * Analyze digital signature fields.
 */
export async function analyzeSignatures(filePath: string): Promise<SignaturesAnalysis> {
  return withSuppressedPdfLibLogs(() => analyzeSignaturesImpl(filePath));
}

async function analyzeSignaturesImpl(filePath: string): Promise<SignaturesAnalysis> {
  const doc = await loadWithPdfLib(filePath);
  const fields: SignatureFieldInfo[] = [];

  try {
    const acroForm = doc.catalog.getAcroForm();
    if (!acroForm) {
      return {
        totalFields: 0,
        signedCount: 0,
        unsignedCount: 0,
        fields: [],
        note: 'No AcroForm found in the document.',
      };
    }

    const allFields = acroForm.getAllFields();

    for (const [field, _ref] of allFields) {
      // Signature fields only (ISO 32000-2 §12.7.5.5: FT shall be Sig).
      // A field with no FT is inherited or malformed — either way, not ours.
      const ftName = field.dict.lookupMaybe(PDFName.of('FT'), PDFName);
      if (ftName?.decodeText() !== 'Sig') continue;

      const fieldName = field.getFullyQualifiedName() ?? field.getPartialName() ?? '(unnamed)';
      const vObj = field.dict.get(PDFName.of('V'));

      let isSigned = false;
      let signerName: string | null = null;
      let reason: string | null = null;
      let location: string | null = null;
      let contactInfo: string | null = null;
      let signingTime: string | null = null;
      let filter: string | null = null;
      let subFilter: string | null = null;

      // If V exists, the field has been signed
      if (vObj) {
        isSigned = true;

        let sigDict: PDFDict | undefined;
        if (vObj instanceof PDFRef) {
          const resolved = doc.context.lookup(vObj);
          if (resolved instanceof PDFDict) sigDict = resolved;
        } else if (vObj instanceof PDFDict) {
          sigDict = vObj;
        }

        if (sigDict) {
          signerName = extractStringFromDict(sigDict, 'Name');
          reason = extractStringFromDict(sigDict, 'Reason');
          location = extractStringFromDict(sigDict, 'Location');
          contactInfo = extractStringFromDict(sigDict, 'ContactInfo');
          signingTime = extractStringFromDict(sigDict, 'M');

          const filterObj = sigDict.lookupMaybe(PDFName.of('Filter'), PDFName);
          filter = filterObj?.decodeText() ?? null;

          const subFilterObj = sigDict.lookupMaybe(PDFName.of('SubFilter'), PDFName);
          subFilter = subFilterObj?.decodeText() ?? null;
        }
      }

      fields.push({
        fieldName,
        isSigned,
        signerName,
        reason,
        location,
        contactInfo,
        signingTime,
        filter,
        subFilter,
      });
    }
  } catch {
    // Some PDFs may have malformed AcroForm
  }

  const signedCount = fields.filter((f) => f.isSigned).length;
  return {
    totalFields: fields.length,
    signedCount,
    unsignedCount: fields.length - signedCount,
    fields,
    note: 'Cryptographic signature verification is not performed. Only field structure is inspected.',
  };
}

// ─── Internal helpers ────────────────────────────────────

/** A PDF version as written in a header or catalog: `major.minor`. */
const PDF_VERSION_PATTERN = /^(\d+)\.(\d+)$/;

/**
 * Read the version from the file header (`%PDF-x.y`, ISO 32000-2 §7.5.2).
 *
 * Only the first 20 bytes are read — the header is at the very start, and the
 * file may be large.
 */
async function readHeaderVersion(filePath: string): Promise<string | null> {
  try {
    const fh = await open(filePath, 'r');
    try {
      const buf = Buffer.alloc(20);
      await fh.read(buf, 0, 20, 0);
      return buf.toString('ascii').match(/%PDF-(\d+\.\d+)/)?.[1] ?? null;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/** Compare `major.minor` versions. Returns > 0 if `a` is later than `b`. */
function compareVersions(a: string, b: string): number {
  const ma = a.match(PDF_VERSION_PATTERN);
  const mb = b.match(PDF_VERSION_PATTERN);
  if (!ma || !mb) return 0;
  return Number(ma[1]) - Number(mb[1]) || Number(ma[2]) - Number(mb[2]);
}

/**
 * Resolve the PDF version the document conforms to.
 *
 * ISO 32000-2 Table 29 (Version) makes the catalog entry conditional, not
 * authoritative: it is the version "to which the document conforms … **if later
 * than the version specified in the file's header**. If the header specifies a
 * later version, or if this entry is absent, the document shall conform to the
 * version specified in the header."
 *
 * So the answer is the later of the two. The previous code returned the catalog
 * entry unconditionally whenever it existed, which reports the wrong version for
 * a file whose header is newer — the exact case Table 29 calls out. (The entry
 * exists so a version can be *raised* by an incremental update; see §7.5.6.)
 *
 * A malformed catalog entry cannot be shown to specify a later version, so the
 * header wins by default.
 *
 * Exported for unit testing — the interesting cases (header newer, versions
 * equal, catalog malformed) would each need a hand-built PDF otherwise.
 */
export function resolvePdfVersion(
  headerVersion: string | null,
  catalogVersion: string | null,
): string | null {
  if (!catalogVersion) return headerVersion;
  if (!headerVersion) return PDF_VERSION_PATTERN.test(catalogVersion) ? catalogVersion : null;
  return compareVersions(catalogVersion, headerVersion) > 0 ? catalogVersion : headerVersion;
}

/**
 * Resolve a value that may be a direct object or an indirect reference to a PDFDict.
 */
function resolveDict(doc: PDFDocument, obj: unknown): PDFDict | undefined {
  if (obj instanceof PDFDict) return obj;
  if (obj instanceof PDFRef) {
    const resolved = trySilently(() => doc.context.lookup(obj));
    if (resolved instanceof PDFDict) return resolved;
  }
  return undefined;
}

/**
 * Resolve the CIDFont dictionary of a Type 0 (composite) font.
 *
 * ISO 32000-2 Table 119 defines DescendantFonts as "(Required) A one-element
 * array specifying the CIDFont dictionary that is the descendant of this Type 0
 * font", and §9.7.6.2 states "In PDF, the font number shall be 0" — so index 0
 * is the only descendant. The array itself may also be an indirect reference.
 *
 * Returns `undefined` for malformed fonts (missing / empty DescendantFonts),
 * which the caller reports as not embedded — the descriptor is unreachable, so
 * embedding cannot be asserted.
 */
function resolveDescendantFont(doc: PDFDocument, type0Font: PDFDict): PDFDict | undefined {
  const descendants = trySilently(() =>
    type0Font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray),
  );
  if (!descendants || descendants.size() === 0) return undefined;
  return resolveDict(doc, descendants.get(0));
}

/**
 * Report whether a font dictionary's FontDescriptor carries an embedded font
 * program. ISO 32000-2 §9.8.2 Table 121: FontFile (Type 1), FontFile2
 * (TrueType), FontFile3 (Type 1C / CIDFontType0C / OpenType).
 */
function hasEmbeddedFontFile(doc: PDFDocument, fontDict: PDFDict): boolean {
  const descriptor = resolveDict(doc, fontDict.get(PDFName.of('FontDescriptor')));
  if (!descriptor) return false;
  return (
    descriptor.has(PDFName.of('FontFile')) ||
    descriptor.has(PDFName.of('FontFile2')) ||
    descriptor.has(PDFName.of('FontFile3'))
  );
}

/**
 * Summarize a PDF object for display (truncated).
 */
function summarizeObject(obj: unknown): string {
  if (obj instanceof PDFRef) return `ref(${obj.objectNumber})`;
  if (obj instanceof PDFName) return obj.decodeText();
  if (obj instanceof PDFArray) return `Array[${obj.size()}]`;
  if (obj instanceof PDFDict) return `Dict{${obj.entries().length} entries}`;
  if (obj instanceof PDFStream) return `Stream{${obj.getContentsSize()} bytes}`;
  if (obj instanceof PDFNumber) return String(obj.asNumber());
  if (obj instanceof PDFString) return obj.decodeText();
  if (obj instanceof PDFHexString) return obj.decodeText();
  if (obj === undefined || obj === null) return 'null';
  return String(obj);
}

/**
 * Extract a string value from a PDFDict by key name.
 */
function extractStringFromDict(dict: PDFDict, key: string): string | null {
  const obj = dict.get(PDFName.of(key));
  if (obj instanceof PDFString) return obj.decodeText();
  if (obj instanceof PDFHexString) return obj.decodeText();
  if (obj instanceof PDFName) return obj.decodeText();
  return null;
}
