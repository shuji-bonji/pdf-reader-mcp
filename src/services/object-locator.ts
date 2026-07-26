/**
 * Object number → drawing coordinates (Issue #20 / family gap G-A).
 *
 * `pdf-verify-mcp` can say *which objects* an incremental update rewrote, and
 * `pdf-writer-mcp`'s `add_annotation` wants a page number and a rectangle. This
 * service is the bridge between the two: given object numbers, it reports where
 * on the page each object is, in the coordinate system the writer expects
 * (PDF user space, origin bottom-left, pt).
 *
 * It OBSERVES. Nothing here judges whether an object should have changed —
 * that is a question the family answers elsewhere, and mostly not at all.
 *
 * What it cannot do, and says so instead of guessing:
 *
 *   - **A content stream draws the whole page.** Narrowing "obj 6 changed" to
 *     the paragraph that moved needs a content-stream walk with the graphics
 *     state carried along; that is the second half of Issue #20 (structure
 *     element → bbox) and is not implemented here. The page box is returned
 *     with the basis saying exactly that.
 *   - **Resources (fonts, images, colour spaces) have no coordinates.** The
 *     page that uses them is reported; the rectangle stays null.
 *   - **An object that no longer exists** — freed by a later revision, which is
 *     precisely what a diff may hand over — is reported as `found: false`, not
 *     as "no coordinates".
 */

import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import type { LocatedObject, ObjectLocation, ObjectLocationResult, ObjectRect } from '../types.js';
import { loadWithPdfLib } from './pdflib-service.js';

/** Resource categories whose entries are reachable from a page. */
const RESOURCE_CATEGORIES = [
  'XObject',
  'Font',
  'ExtGState',
  'Shading',
  'Pattern',
  'ColorSpace',
  'Properties',
] as const;

/**
 * Normalise a `/Rect` array. ISO 32000-1 §7.9.5: a rectangle is written as two
 * diagonally opposite corners in either order, and "shall be normalised" before
 * use. `add_annotation` requires x1 < x2 and y1 < y2, so this is what makes the
 * result directly usable there.
 */
function normaliseRect(values: number[]): ObjectRect | null {
  if (values.length !== 4 || values.some((v) => !Number.isFinite(v))) return null;
  const [a, b, c, d] = values;
  return {
    x1: Math.min(a, c),
    y1: Math.min(b, d),
    x2: Math.max(a, c),
    y2: Math.max(b, d),
  };
}

function numberArray(value: unknown, doc: PDFDocument): number[] | null {
  const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value;
  if (!(resolved instanceof PDFArray)) return null;
  const numbers: number[] = [];
  for (let i = 0; i < resolved.size(); i += 1) {
    const item = resolved.lookup(i);
    if (!(item instanceof PDFNumber)) return null;
    numbers.push(item.asNumber());
  }
  return numbers;
}

function nameOf(dict: PDFDict, key: string): string | null {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFName ? value.decodeText() : null;
}

/** Refs reachable from a page, with how they are reachable. */
interface PageIndex {
  /** 1-based page number by ref tag */
  pageNumberByRef: Map<string, number>;
  /** Page box (crop box when present, else media box) by page number */
  boxByPage: Map<number, ObjectRect>;
  /** annotation ref tag → page numbers */
  annotationPages: Map<string, number[]>;
  /** content stream ref tag → page numbers */
  contentPages: Map<string, number[]>;
  /** resource ref tag → page numbers */
  resourcePages: Map<string, number[]>;
}

function push(map: Map<string, number[]>, key: string, page: number): void {
  const list = map.get(key);
  if (list) {
    if (!list.includes(page)) list.push(page);
  } else {
    map.set(key, [page]);
  }
}

function buildPageIndex(doc: PDFDocument): PageIndex {
  const index: PageIndex = {
    pageNumberByRef: new Map(),
    boxByPage: new Map(),
    annotationPages: new Map(),
    contentPages: new Map(),
    resourcePages: new Map(),
  };

  let pages: ReturnType<PDFDocument['getPages']> = [];
  try {
    pages = doc.getPages();
  } catch {
    // A page tree pdf-lib cannot walk (linearised hint streams, damaged trees)
    // leaves the index empty; objects then resolve without a page rather than
    // with a wrong one.
    return index;
  }

  pages.forEach((page, i) => {
    const pageNumber = i + 1;
    index.pageNumberByRef.set(page.ref.tag, pageNumber);

    try {
      // pdf-lib's getCropBox already falls back to the media box when no crop
      // box is set, which is the inheritance rule of ISO 32000-1 §7.7.3.3.
      const box = page.getCropBox();
      index.boxByPage.set(pageNumber, {
        x1: box.x,
        y1: box.y,
        x2: box.x + box.width,
        y2: box.y + box.height,
      });
    } catch {
      // no box: the object still gets a page number, just no rectangle
    }

    const node = page.node;

    const annots = node.get(PDFName.of('Annots'));
    const annotsArray = annots instanceof PDFRef ? doc.context.lookup(annots) : annots;
    if (annotsArray instanceof PDFArray) {
      for (let n = 0; n < annotsArray.size(); n += 1) {
        const entry = annotsArray.get(n);
        if (entry instanceof PDFRef) push(index.annotationPages, entry.tag, pageNumber);
      }
    }

    const contents = node.get(PDFName.of('Contents'));
    if (contents instanceof PDFRef) {
      push(index.contentPages, contents.tag, pageNumber);
    } else if (contents instanceof PDFArray) {
      for (let n = 0; n < contents.size(); n += 1) {
        const entry = contents.get(n);
        if (entry instanceof PDFRef) push(index.contentPages, entry.tag, pageNumber);
      }
    }

    const resourcesValue = node.get(PDFName.of('Resources'));
    const resources =
      resourcesValue instanceof PDFRef ? doc.context.lookup(resourcesValue) : resourcesValue;
    if (resources instanceof PDFDict) {
      if (resourcesValue instanceof PDFRef) {
        push(index.resourcePages, resourcesValue.tag, pageNumber);
      }
      for (const category of RESOURCE_CATEGORIES) {
        const groupValue = resources.get(PDFName.of(category));
        const group = groupValue instanceof PDFRef ? doc.context.lookup(groupValue) : groupValue;
        if (!(group instanceof PDFDict)) continue;
        if (groupValue instanceof PDFRef) push(index.resourcePages, groupValue.tag, pageNumber);
        for (const [, value] of group.entries()) {
          if (value instanceof PDFRef) push(index.resourcePages, value.tag, pageNumber);
        }
      }
    }
  });

  return index;
}

/** Page number an annotation names through `/P`, when it names one. */
function pageFromAnnotationParent(dict: PDFDict, index: PageIndex): number | null {
  const parent = dict.get(PDFName.of('P'));
  if (!(parent instanceof PDFRef)) return null;
  return index.pageNumberByRef.get(parent.tag) ?? null;
}

function locateDict(
  doc: PDFDocument,
  ref: PDFRef,
  dict: PDFDict,
  index: PageIndex,
): { locations: ObjectLocation[]; reason: string | null } {
  const locations: ObjectLocation[] = [];
  const type = nameOf(dict, 'Type');

  // 1. Anything carrying a /Rect states its own rectangle. Annotations are the
  //    case that matters: this is the coordinate add_annotation wants.
  const rect = normaliseRect(numberArray(dict.get(PDFName.of('Rect')), doc) ?? []);
  if (rect) {
    const pages =
      index.annotationPages.get(ref.tag) ??
      (() => {
        const viaParent = pageFromAnnotationParent(dict, index);
        return viaParent === null ? [] : [viaParent];
      })();
    if (pages.length === 0) {
      locations.push({ page: null, rect, basis: 'annotation-rect' });
    } else {
      for (const page of pages) locations.push({ page, rect, basis: 'annotation-rect' });
    }
    return { locations, reason: null };
  }

  // 2. The page object itself.
  const asPage = index.pageNumberByRef.get(ref.tag);
  if (asPage !== undefined) {
    locations.push({ page: asPage, rect: index.boxByPage.get(asPage) ?? null, basis: 'page-box' });
    return { locations, reason: null };
  }

  // 3. Structural objects with no place on any page.
  if (type === 'Catalog' || type === 'Pages' || type === 'StructTreeRoot' || type === 'Metadata') {
    return {
      locations: [],
      reason: `${type} is a document-level object and is not drawn anywhere`,
    };
  }

  return { locations: [], reason: null };
}

/**
 * Locate the given object numbers. Objects are matched by number: the
 * generation actually present in the document is reported back, so a caller
 * holding a stale generation still gets an answer rather than a miss.
 */
export async function locateObjects(
  filePath: string,
  objectNumbers: number[],
): Promise<ObjectLocationResult> {
  const doc = await loadWithPdfLib(filePath);
  const index = buildPageIndex(doc);
  const notes: string[] = [];

  const wanted = new Set(objectNumbers);
  const byNumber = new Map<number, { ref: PDFRef; object: unknown }>();
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (wanted.has(ref.objectNumber)) byNumber.set(ref.objectNumber, { ref, object });
  }

  if (index.pageNumberByRef.size === 0) {
    notes.push(
      'The page tree could not be walked, so no object could be tied to a page number. ' +
        "Rectangles read from an object's own /Rect are still reported.",
    );
  }
  if (doc.isEncrypted) {
    notes.push(
      'The document is encrypted. Numbers and names are not encrypted (ISO 32000-1 §7.6.2), so ' +
        'coordinates and types are reliable, but strings are not decrypted here — field names are ' +
        'reported as null rather than as mojibake.',
    );
  }

  const objects: LocatedObject[] = objectNumbers.map((objectNumber) => {
    const hit = byNumber.get(objectNumber);
    if (!hit) {
      return {
        objectNumber,
        generation: null,
        found: false,
        type: null,
        subtype: null,
        fieldName: null,
        locations: [],
        reason:
          'No object with this number exists in the document as parsed. An object freed by a ' +
          'later revision is expected to look like this.',
      };
    }

    const { ref, object } = hit;
    if (!(object instanceof PDFDict)) {
      // Streams are PDFStream, whose dictionary is reachable; everything else
      // (numbers, arrays) has no location of its own.
      const streamDict = (object as { dict?: PDFDict })?.dict;
      const contentPages = index.contentPages.get(ref.tag) ?? [];
      const resourcePages = index.resourcePages.get(ref.tag) ?? [];
      if (contentPages.length > 0) {
        return {
          objectNumber,
          generation: ref.generationNumber,
          found: true,
          type: streamDict ? nameOf(streamDict, 'Type') : null,
          subtype: streamDict ? nameOf(streamDict, 'Subtype') : null,
          fieldName: null,
          locations: contentPages.map((page) => ({
            page,
            rect: index.boxByPage.get(page) ?? null,
            basis: 'page-content-stream' as const,
          })),
          reason:
            "This is the page's content stream, so the rectangle is the whole page. Narrowing it " +
            'to the part that changed needs a content-stream walk, which this tool does not do.',
        };
      }
      if (resourcePages.length > 0) {
        return {
          objectNumber,
          generation: ref.generationNumber,
          found: true,
          type: streamDict ? nameOf(streamDict, 'Type') : null,
          subtype: streamDict ? nameOf(streamDict, 'Subtype') : null,
          fieldName: null,
          locations: resourcePages.map((page) => ({
            page,
            rect: null,
            basis: 'page-resource' as const,
          })),
          reason:
            'A resource (font, image, colour space, …) is used by the page but has no rectangle ' +
            'of its own; where it is drawn is decided by the content stream.',
        };
      }
      return {
        objectNumber,
        generation: ref.generationNumber,
        found: true,
        type: streamDict ? nameOf(streamDict, 'Type') : null,
        subtype: streamDict ? nameOf(streamDict, 'Subtype') : null,
        fieldName: null,
        locations: [],
        reason: 'No page references this object, so it has no place on any page.',
      };
    }

    const { locations, reason } = locateDict(doc, ref, object, index);
    let finalReason = reason;
    if (locations.length === 0) {
      const contentPages = index.contentPages.get(ref.tag) ?? [];
      const resourcePages = index.resourcePages.get(ref.tag) ?? [];
      if (contentPages.length > 0) {
        for (const page of contentPages) {
          locations.push({
            page,
            rect: index.boxByPage.get(page) ?? null,
            basis: 'page-content-stream',
          });
        }
        finalReason =
          "This is the page's content stream, so the rectangle is the whole page. Narrowing it to " +
          'the part that changed needs a content-stream walk, which this tool does not do.';
      } else if (resourcePages.length > 0) {
        for (const page of resourcePages) {
          locations.push({ page, rect: null, basis: 'page-resource' });
        }
        finalReason =
          'A resource is used by the page but has no rectangle of its own; where it is drawn is ' +
          'decided by the content stream.';
      } else if (finalReason === null) {
        finalReason = 'No page references this object, so it has no place on any page.';
      }
    }

    const titleValue = object.get(PDFName.of('T'));
    const fieldName =
      !doc.isEncrypted && (titleValue instanceof PDFString || titleValue instanceof PDFHexString)
        ? titleValue.decodeText()
        : null;

    return {
      objectNumber,
      generation: ref.generationNumber,
      found: true,
      type: nameOf(object, 'Type'),
      subtype: nameOf(object, 'Subtype'),
      fieldName,
      locations,
      reason: finalReason,
    };
  });

  return { objects, isEncrypted: doc.isEncrypted, notes };
}
