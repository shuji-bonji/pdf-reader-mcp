/**
 * Structure-tree walking over pdf-lib objects.
 *
 * Split out of `struct-tree-service` so that consumers which need only the
 * *shape* of the structure tree do not pull in pdfjs. `struct-tree-service`
 * combines this with pdfjs text; `actual-text-service` needs the walk alone,
 * and importing it from a module that in turn imports pdfjs-service would make
 * the two services circular.
 *
 * Walks the document's logical structure hierarchy from the catalog's
 * `StructTreeRoot`, depth-first — which is exactly how ISO 32000-2 §14.8.2.5
 * defines logical content order:
 *
 * > Logical content order - the ordering for semantic purposes - shall be
 * > defined by a depth-first traversal of the document's logical structure
 * > hierarchy.
 *
 * ## Why not `page.getStructTree()`?
 *
 * pdfjs only offers a per-page view. Merging those per page - which is what
 * `extract_tables` and `inspect_tags` do - cannot produce logical content order,
 * because §14.8.2.5 NOTE 2 allows a single logical object to span pages:
 *
 * > A logical object can extend over more than one PDF page ...
 *
 * pdfjs's per-page nodes carry no element identity (`role` + `children` only),
 * so once merged there is no way to recover that page 1's `L` and page 2's `L`
 * are the same list. Walking the document tree keeps them whole.
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

/**
 * A marked-content reference: the text this structure element owns on one page.
 *
 * `pageObjNum` is the object number of the `/Pg` page, which is what pdfjs's
 * marked-content id is built from (see `pdfjsMarkedContentId`).
 */
export interface ContentRef {
  pageObjNum: number;
  mcid: number;
}

/** A node in the document's logical structure hierarchy. */
export interface StructElement {
  /** The structure type, `/S` (e.g. `H1`, `P`, `Table`). */
  role: string;
  /**
   * `/ActualText` — a **character-level replacement** for the content
   * (ISO 32000-2 §14.9.4: "shall be used as a replacement, not a description").
   * When present it supersedes the glyphs; it is not a description.
   */
  actualText: string | null;
  /**
   * `/Alt` — an **alternate description** for content that "does not translate
   * naturally into text" (§14.9.3), e.g. a Figure. This is a description *of*
   * the content, not the content, so it is kept apart from the text and must
   * never be reported as the element's text.
   */
  alt: string | null;
  /** `/Lang`, if this element overrides the document language (§14.9.2). */
  lang: string | null;
  /** Marked-content references owned directly by this element, in order. */
  contentRefs: ContentRef[];
  /** Child structure elements, in document order. */
  children: StructElement[];
}

/**
 * Build the pdfjs marked-content id for a `/Pg` + `/MCID` pair.
 *
 * pdfjs names marked content `p{pageObjectNumber}R_mc{mcid}` — verified against
 * pdfjs-dist in `tests/tier1/struct-tree-service.test.ts`. Note it drops the
 * generation number (`p7R`, not `p7_0R`).
 *
 * This format is pdfjs's internal convention, not a published contract, so the
 * test asserts it against real pdfjs output: if a pdfjs upgrade renames these,
 * the test fails rather than the tool silently returning empty text. (D-2 was
 * caused by hardcoding pdfjs constants without such a guard.)
 */
export function pdfjsMarkedContentId(ref: ContentRef): string {
  return `p${ref.pageObjNum}R_mc${ref.mcid}`;
}

/** Resolve a value that may be an indirect reference. */
export function deref(doc: PDFDocument, obj: unknown): unknown {
  return obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
}

/**
 * Read a text-ish value (`PDFString` / `PDFHexString`) from a dictionary.
 *
 * **Encrypted documents yield nothing.** ISO 32000-2 §7.6.2 encrypts *strings
 * and streams* and nothing else, so an encrypted file's structure tree still
 * walks correctly — the names, numbers and references are all in the clear —
 * but every string in it is ciphertext, and pdf-lib does not decrypt (it is
 * loaded with `ignoreEncryption`, which ignores, not decrypts).
 *
 * Returning the ciphertext would be far worse than returning nothing: measured
 * on `PDF32000_2008.pdf` (owner-password encrypted, fully readable in any
 * viewer), the tree carries **18026** `/ActualText` entries, every one of them
 * bytes like `&)ð`. Since #18 those entries *replace* page text, so this
 * would have substituted garbage for the body of every such document.
 */
function textEntry(doc: PDFDocument, dict: PDFDict, key: string): string | null {
  if (doc.isEncrypted) return null;
  const value = deref(doc, dict.get(PDFName.of(key)));
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return null;
}

/** Normalise `/K` — it may be absent, a single object, or an array. */
function kidsOf(doc: PDFDocument, dict: PDFDict): unknown[] {
  const k = deref(doc, dict.get(PDFName.of('K')));
  if (k === undefined || k === null) return [];
  if (k instanceof PDFArray) return k.asArray();
  return [k];
}

/**
 * Walk one structure element.
 *
 * `/K` is polymorphic (§14.7.2 Table 355) and every form has to be handled:
 *
 *  - **integer** — an MCID on the element's own (possibly inherited) `/Pg`
 *  - **MCR dict** — an MCID with its own `/Pg`, which is how an element points
 *    at content on a page other than its own. This is the page-spanning case.
 *  - **OBJR dict** — a reference to an annotation or form field. Skipped: it
 *    owns no page text.
 *  - **StructElem dict** — a child element, recursed into
 *
 * `/Pg` is inherited: an element without one uses its nearest ancestor's.
 */
function walkElement(
  doc: PDFDocument,
  dict: PDFDict,
  inheritedPg: PDFRef | undefined,
): StructElement | null {
  const s = deref(doc, dict.get(PDFName.of('S')));
  if (!(s instanceof PDFName)) return null;

  const pgValue = dict.get(PDFName.of('Pg'));
  const pg = pgValue instanceof PDFRef ? pgValue : inheritedPg;

  const element: StructElement = {
    role: s.decodeText(),
    actualText: textEntry(doc, dict, 'ActualText'),
    alt: textEntry(doc, dict, 'Alt'),
    lang: textEntry(doc, dict, 'Lang'),
    contentRefs: [],
    children: [],
  };

  for (const kid of kidsOf(doc, dict)) {
    // An MCID written directly, on this element's page.
    if (kid instanceof PDFNumber) {
      if (pg) element.contentRefs.push({ pageObjNum: pg.objectNumber, mcid: kid.asNumber() });
      continue;
    }

    const resolved = deref(doc, kid);
    if (!(resolved instanceof PDFDict)) continue;

    const type = resolved.get(PDFName.of('Type'));
    const typeName = type instanceof PDFName ? type.decodeText() : null;

    if (typeName === 'MCR') {
      const mcid = deref(doc, resolved.get(PDFName.of('MCID')));
      const mcrPgValue = resolved.get(PDFName.of('Pg'));
      const mcrPg = mcrPgValue instanceof PDFRef ? mcrPgValue : pg;
      if (mcid instanceof PDFNumber && mcrPg) {
        element.contentRefs.push({ pageObjNum: mcrPg.objectNumber, mcid: mcid.asNumber() });
      }
      continue;
    }

    // OBJR points at an annotation or form field, which carries no page text.
    if (typeName === 'OBJR') continue;

    // Anything with an /S is a child structure element. Checking /S rather than
    // Type == StructElem on purpose: Type is optional in practice and plenty of
    // producers omit it.
    if (resolved.get(PDFName.of('S'))) {
      const child = walkElement(doc, resolved, pg);
      if (child) element.children.push(child);
    }
  }

  return element;
}

/**
 * Walk the document's structure tree from the catalog.
 *
 * Returns the top-level structure elements in document order, or `null` when the
 * catalog has no `StructTreeRoot` (an untagged document, or one whose structure
 * tree is unreachable).
 *
 * Note this reads only `StructTreeRoot`; it needs neither `/ParentTree` nor
 * `/StructParents`, which pdfjs's per-page `getStructTree()` does require.
 */
export function walkStructTree(doc: PDFDocument): StructElement[] | null {
  const root = deref(doc, doc.catalog.get(PDFName.of('StructTreeRoot')));
  if (!(root instanceof PDFDict)) return null;

  const elements: StructElement[] = [];
  for (const kid of kidsOf(doc, root)) {
    const resolved = deref(doc, kid);
    if (resolved instanceof PDFDict && resolved.get(PDFName.of('S'))) {
      const element = walkElement(doc, resolved, undefined);
      if (element) elements.push(element);
    }
  }
  return elements;
}

/** Collect every content reference under an element, in document order. */
export function collectContentRefs(element: StructElement, into: ContentRef[] = []): ContentRef[] {
  into.push(...element.contentRefs);
  for (const child of element.children) collectContentRefs(child, into);
  return into;
}
