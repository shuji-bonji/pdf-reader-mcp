/**
 * pdf-lib wrapper service.
 *
 * Provides low-level PDF structure access via pdf-lib for Tier 2 tools.
 * Runs alongside pdfjs-service.ts (which handles text/image extraction).
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  PDFHexString,
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
import { readFile } from 'node:fs/promises';
import { readPdfFile } from '../utils/pdf-helpers.js';

/**
 * Load a PDF document with pdf-lib.
 */
export async function loadWithPdfLib(filePath: string): Promise<PDFDocument> {
  const data = await readPdfFile(filePath);
  const doc = await PDFDocument.load(data, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  return doc;
}

/**
 * Check if a PDF is encrypted.
 */
export async function detectEncryption(filePath: string): Promise<boolean> {
  try {
    const data = await readPdfFile(filePath);
    const doc = await PDFDocument.load(data, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    return doc.isEncrypted;
  } catch {
    return false;
  }
}

/**
 * Analyze PDF internal structure (catalog, page tree, objects).
 */
export async function analyzeStructure(filePath: string): Promise<StructureAnalysis> {
  const doc = await loadWithPdfLib(filePath);
  const catalog = doc.catalog;
  const context = doc.context;

  // Extract catalog entries
  const catalogEntries: CatalogEntry[] = [];
  for (const [key, value] of catalog.entries()) {
    catalogEntries.push({
      key: key.decodeText(),
      type: value.constructor.name,
      value: summarizeObject(value),
    });
  }

  // Page tree info
  const pages = doc.getPages();
  const maxSamples = Math.min(pages.length, 5);
  const mediaBoxSamples: PageTreeInfo['mediaBoxSamples'] = [];
  for (let i = 0; i < maxSamples; i++) {
    const box = pages[i].getMediaBox();
    mediaBoxSamples.push({
      page: i + 1,
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
    });
  }

  const pageTree: PageTreeInfo = {
    totalPages: doc.getPageCount(),
    mediaBoxSamples,
  };

  // Object statistics
  const allObjects = context.enumerateIndirectObjects();
  const byType: Record<string, number> = {};
  let streamCount = 0;

  for (const [_ref, obj] of allObjects) {
    const typeName = obj.constructor.name;
    byType[typeName] = (byType[typeName] ?? 0) + 1;
    if (obj instanceof PDFStream) {
      streamCount++;
    }
  }

  const objectStats: ObjectStats = {
    totalObjects: allObjects.length,
    streamCount,
    byType,
  };

  // PDF version: prefer catalog /Version, fallback to file header %PDF-x.y
  let pdfVersion: string | null = null;
  const versionEntry = catalog.lookupMaybe(PDFName.of('Version'), PDFName);
  if (versionEntry) {
    pdfVersion = versionEntry.decodeText();
  } else {
    try {
      const header = await readFile(filePath, { encoding: 'ascii' });
      const match = header.slice(0, 20).match(/%PDF-(\d+\.\d+)/);
      if (match) pdfVersion = match[1];
    } catch {
      // Ignore header read errors
    }
  }

  return {
    catalog: catalogEntries,
    pageTree,
    objectStats,
    isEncrypted: doc.isEncrypted,
    pdfVersion,
  };
}

/** Font analysis result including font map and total pages scanned */
export interface FontAnalysisResult {
  fontMap: Map<string, FontInfo>;
  pagesScanned: number;
}

/**
 * Analyze fonts across all pages using pdf-lib's low-level access.
 * Returns font map and total pages scanned.
 */
export async function analyzeFontsWithPdfLib(filePath: string): Promise<FontAnalysisResult> {
  const doc = await loadWithPdfLib(filePath);
  const fontMap = new Map<string, FontInfo>();
  const pages = doc.getPages();

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageNum = pageIdx + 1;
    const pageNode = pages[pageIdx].node;
    const resources = pageNode.Resources();
    if (!resources) continue;

    const fontDict = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
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
