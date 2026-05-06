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

  // PDF version: prefer catalog /Version, fallback to file header %PDF-x.y
  let pdfVersion: string | null = null;
  const versionEntry = trySilently(() => catalog.lookupMaybe(PDFName.of('Version'), PDFName));
  if (versionEntry) {
    pdfVersion = versionEntry.decodeText();
  } else {
    try {
      // Read only the first 20 bytes for the PDF header instead of the entire file
      const fh = await open(filePath, 'r');
      try {
        const buf = Buffer.alloc(20);
        await fh.read(buf, 0, 20, 0);
        const match = buf.toString('ascii').match(/%PDF-(\d+\.\d+)/);
        if (match) pdfVersion = match[1];
      } finally {
        await fh.close();
      }
    } catch {
      // Ignore header read errors
    }
  }

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

      // Check if font is embedded (has FontDescriptor with FontFile/FontFile2/FontFile3)
      let isEmbedded = false;
      const descriptorRef = actualFont.get(PDFName.of('FontDescriptor'));
      if (descriptorRef) {
        let descriptor: PDFDict | undefined;
        if (descriptorRef instanceof PDFRef) {
          const resolved = doc.context.lookup(descriptorRef);
          if (resolved instanceof PDFDict) descriptor = resolved;
        } else if (descriptorRef instanceof PDFDict) {
          descriptor = descriptorRef;
        }
        if (descriptor) {
          isEmbedded =
            descriptor.has(PDFName.of('FontFile')) ||
            descriptor.has(PDFName.of('FontFile2')) ||
            descriptor.has(PDFName.of('FontFile3'));
        }
      }

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
      const ftName = field.dict.lookupMaybe(PDFName.of('FT'), PDFName);
      if (!ftName || ftName.decodeText() !== 'Sig') continue;

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
