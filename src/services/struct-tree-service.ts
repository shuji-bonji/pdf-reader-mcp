/**
 * Structure tree walker.
 *
 * Walks the document's logical structure hierarchy from the catalog's
 * `StructTreeRoot`, depth-first — which is exactly how ISO 32000-2 §14.8.2.5
 * defines logical content order:
 *
 * > Logical content order – the ordering for semantic purposes – shall be
 * > defined by a depth-first traversal of the document's logical structure
 * > hierarchy.
 *
 * ## Why not `page.getStructTree()`?
 *
 * pdfjs only offers a per-page view. Merging those per page — which is what
 * `extract_tables` and `inspect_tags` do — cannot produce logical content order,
 * because §14.8.2.5 NOTE 2 allows a single logical object to span pages:
 *
 * > A logical object can extend over more than one PDF page …
 *
 * Measured on `tests/fixtures/structured.pdf` (one paragraph and one list, each
 * split across two pages):
 *
 * | | this walker | per-page merge |
 * |---|---|---|
 * | `Document` | 1 | 2 (duplicated per page) |
 * | `L` | 1 (with 2 `LI`) | 2 (with 1 `LI` each) |
 *
 * pdfjs's per-page nodes carry no element identity (`role` + `children` only),
 * so once merged there is no way to recover that page 1's `L` and page 2's `L`
 * are the same list. Walking the document tree keeps them whole.
 *
 * ## Division of labour
 *
 * This module uses pdf-lib and returns *structure* plus the marked-content
 * references that locate the text. It does not read text — resolving MCIDs to
 * strings needs pdfjs, and lives in `pdfjs-service.ts`. Structure from pdf-lib,
 * text from pdfjs.
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
import type {
  StructuredElement,
  StructuredTableCell,
  StructuredTextResult,
  TagNode,
  TagsAnalysis,
} from '../types.js';
import { resolvePageNumbers } from '../utils/pdf-helpers.js';
import {
  buildDocumentIdToTextMap,
  LINE_BREAK,
  loadDocument,
  resolveLineBreaks,
} from './pdfjs-service.js';
import { loadWithPdfLib } from './pdflib-service.js';

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
function deref(doc: PDFDocument, obj: unknown): unknown {
  return obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
}

/** Read a text-ish value (`PDFString` / `PDFHexString`) from a dictionary. */
function textEntry(doc: PDFDocument, dict: PDFDict, key: string): string | null {
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

// ─── Structured text (M-8) ───────────────────────────────

/**
 * Roles whose children are structural scaffolding rather than prose, and whose
 * text therefore should not be rolled up from descendants.
 *
 * `Table` gets `rows` instead (it is two-dimensional; `depth` cannot express
 * "row 2, column 3"), and `L` / `LI` have their items emitted separately.
 */
const CONTAINER_ROLES = new Set([
  'Document',
  'Part',
  'Art',
  'Sect',
  'Div',
  'Table',
  'L',
  'LI',
  'TR',
]);

/** `Lbl` is a list label ("•", "1."), not body text — reported separately. */
const LABEL_ROLE = 'Lbl';

/**
 * Assemble the text of an element from its marked content.
 *
 * `/ActualText` wins when present: ISO 32000-2 §14.9.4 says it "shall be used as
 * a **replacement**, not a description, for the content". `/Alt` is deliberately
 * NOT consulted here — it is a description of content that has no text (§14.9.3),
 * so treating it as text would inject a caption into the body.
 *
 * When an element's content continues on another page, the page boundary is a
 * line break in the original layout and is treated as one. pdfjs emits no EOL
 * marker at the start of a page, so without this a paragraph split across pages
 * extracts as "…page oneand continues…" — and for Japanese the same boundary
 * must produce no space at all, which `resolveLineBreaks` decides.
 */
function textOf(
  element: StructElement,
  idToText: Map<string, string>,
  includeDescendants: boolean,
): string {
  if (element.actualText !== null) return element.actualText;

  const refs = includeDescendants ? collectContentRefs(element) : element.contentRefs;

  let assembled = '';
  let previousPage: number | undefined;
  for (const ref of refs) {
    if (assembled !== '' && previousPage !== undefined && previousPage !== ref.pageObjNum) {
      assembled += LINE_BREAK;
    }
    assembled += idToText.get(pdfjsMarkedContentId(ref)) ?? '';
    previousPage = ref.pageObjNum;
  }
  return resolveLineBreaks(assembled);
}

/** Collapse whitespace runs and trim. Line breaks were already resolved upstream. */
function tidy(text: string): string {
  return text.replace(/[\s　]+/g, ' ').trim();
}

/** Pages an element's content lives on, in order of first appearance. */
function pagesOf(element: StructElement, pageNumByObjNum: Map<number, number>): number[] {
  const seen: number[] = [];
  for (const ref of collectContentRefs(element)) {
    const pageNum = pageNumByObjNum.get(ref.pageObjNum);
    if (pageNum !== undefined && !seen.includes(pageNum)) seen.push(pageNum);
  }
  return seen.sort((a, b) => a - b);
}

/** Build `rows` for a `Table` element by walking TR → TH/TD. */
function tableRows(element: StructElement, idToText: Map<string, string>): StructuredTableCell[][] {
  const rows: StructuredTableCell[][] = [];
  const visitRow = (row: StructElement): void => {
    const cells: StructuredTableCell[] = [];
    for (const cell of row.children) {
      if (cell.role === 'TH' || cell.role === 'TD') {
        cells.push({ text: tidy(textOf(cell, idToText, true)), isHeader: cell.role === 'TH' });
      }
    }
    if (cells.length > 0) rows.push(cells);
  };
  const visit = (node: StructElement): void => {
    for (const child of node.children) {
      if (child.role === 'TR') visitRow(child);
      // THead / TBody / TFoot wrap rows; TR may also sit directly under Table.
      else visit(child);
    }
  };
  visit(element);
  return rows;
}

/**
 * Flatten the structure tree into logical content order.
 *
 * Flat + `depth` rather than nested: a depth-first pre-order plus depth encodes
 * the tree exactly (it is an indented outline), the main consumer walks it
 * linearly to emit Markdown, and it can be truncated at any point without
 * producing broken JSON. `Table` is the exception — see `rows`.
 */
function flatten(
  element: StructElement,
  depth: number,
  idToText: Map<string, string>,
  pageNumByObjNum: Map<number, number>,
  out: StructuredElement[],
): void {
  // A list label belongs to its LI, not to the flow of text.
  if (element.role === LABEL_ROLE) return;

  const isContainer = CONTAINER_ROLES.has(element.role);
  const isTable = element.role === 'Table';

  const entry: StructuredElement = {
    role: element.role,
    depth,
    text: null,
    pages: pagesOf(element, pageNumByObjNum),
  };

  if (isTable) {
    entry.rows = tableRows(element, idToText);
  } else if (!isContainer) {
    // A leaf rolls up its descendants' text (e.g. LBody under LI, Span under P).
    const text = tidy(textOf(element, idToText, true));
    entry.text = text === '' ? null : text;
  }

  if (element.role === 'LI') {
    const label = element.children.find((c) => c.role === LABEL_ROLE);
    if (label) {
      const labelText = tidy(textOf(label, idToText, true));
      if (labelText) entry.label = labelText;
    }
    // The LI's text is its LBody; emit it here so consumers get one entry per item.
    const body = element.children.filter((c) => c.role !== LABEL_ROLE);
    if (body.length > 0) {
      const text = tidy(body.map((b) => textOf(b, idToText, true)).join(''));
      entry.text = text === '' ? null : text;
    }
  }

  if (element.alt !== null) entry.alt = element.alt;
  if (element.lang !== null) entry.lang = element.lang;

  out.push(entry);

  // Table rows and LI bodies are already represented; don't emit them again.
  if (isTable || element.role === 'LI') return;

  for (const child of element.children) {
    flatten(child, depth + 1, idToText, pageNumByObjNum, out);
  }
}

/**
 * Turn a walked structure tree into the flattened, text-bearing result.
 *
 * `pageNumByObjNum` maps page object numbers (as seen in `/Pg`) to 1-based page
 * numbers, so the output speaks in page numbers rather than object numbers.
 */
export function buildStructuredText(
  roots: StructElement[],
  idToText: Map<string, string>,
  pageNumByObjNum: Map<number, number>,
  options: { roles?: string[]; pages?: number[] } = {},
): StructuredElement[] {
  const out: StructuredElement[] = [];
  for (const root of roots) flatten(root, 0, idToText, pageNumByObjNum, out);

  let filtered = out;
  if (options.roles && options.roles.length > 0) {
    const wanted = new Set(options.roles);
    filtered = filtered.filter((e) => wanted.has(e.role));
  }
  if (options.pages && options.pages.length > 0) {
    const wanted = new Set(options.pages);
    // An element that touches the range at all is kept whole — splitting a
    // page-spanning element is precisely what this tool exists to avoid.
    filtered = filtered.filter((e) => e.pages.length === 0 || e.pages.some((p) => wanted.has(p)));
  }
  return filtered;
}

// ─── inspect_tags (C-1) ──────────────────────────────────

/** Convert a walked structure element to a `TagNode` for inspect_tags. */
function toTagNode(element: StructElement, roleCounts: Record<string, number>): TagNode {
  roleCounts[element.role] = (roleCounts[element.role] ?? 0) + 1;
  return {
    role: element.role,
    children: element.children.map((child) => toTagNode(child, roleCounts)),
    contentCount: element.contentRefs.length,
  };
}

function tagDepth(node: TagNode): number {
  if (node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map(tagDepth));
}

function tagCount(node: TagNode): number {
  return 1 + node.children.reduce((sum, child) => sum + tagCount(child), 0);
}

/**
 * Build the inspect_tags analysis from the document's structure tree.
 *
 * C-1: the previous implementation walked `page.getStructTree()` per page and
 * hung all of them under a synthetic `StructTreeRoot` node — so a two-page
 * document reported TWO `Document` roots, and any element spanning pages was
 * duplicated. That is a merge artifact, not the document's structure, and
 * "reporting the structure tree is a fact and reader's job" (family M-2) only
 * holds if the reported tree is the real one. Here `StructTreeRoot` is the
 * actual root of the actual tree: one `Document`, page-spanning elements whole.
 */
export function analyzeTagsFromStructTree(
  roots: StructElement[] | null,
  isTagged: boolean,
): TagsAnalysis {
  if (!isTagged || !roots || roots.length === 0) {
    return { isTagged, rootTag: null, maxDepth: 0, totalElements: 0, roleCounts: {} };
  }

  const roleCounts: Record<string, number> = {};
  const children = roots.map((root) => toTagNode(root, roleCounts));
  const rootTag: TagNode = { role: 'StructTreeRoot', children, contentCount: 0 };

  return {
    isTagged: true,
    rootTag,
    // The StructTreeRoot node itself is one level; tagDepth counts from a child.
    maxDepth: children.length > 0 ? 1 + Math.max(...children.map(tagDepth)) : 1,
    totalElements: children.reduce((sum, child) => sum + tagCount(child), 0),
    roleCounts,
  };
}

/**
 * Analyze a Tagged PDF's structure tree for inspect_tags.
 *
 * Uses the document's `StructTreeRoot` (pdf-lib), not per-page trees — see
 * `analyzeTagsFromStructTree`.
 */
export async function analyzeTags(filePath: string): Promise<TagsAnalysis> {
  const doc = await loadWithPdfLib(filePath);
  const markInfo = deref(doc, doc.catalog.get(PDFName.of('MarkInfo')));
  const marked =
    markInfo instanceof PDFDict ? deref(doc, markInfo.get(PDFName.of('Marked'))) : undefined;
  const isTagged = String(marked) === 'true';
  return analyzeTagsFromStructTree(walkStructTree(doc), isTagged);
}

/**
 * Extract structured text — the `extract_structured_text` service entry point.
 *
 * Reads the document twice on purpose, once per library, because each answers a
 * different question:
 *
 *  - **pdf-lib** — the structure: `StructTreeRoot`, depth-first, with element
 *    identity intact across pages.
 *  - **pdfjs** — the text: marked content resolved to strings.
 *
 * Untagged documents return `isTagged: false` with a reason and no elements.
 * Nothing is guessed: §14.8.2.5 NOTE 1 is explicit that page content order need
 * not match logical content order, so clustering by coordinates would be an
 * invention, not an observation — and reader reports observations.
 */
export async function extractStructuredText(
  filePath: string,
  options: { pages?: string; roles?: string[] } = {},
): Promise<StructuredTextResult> {
  const libDoc = await loadWithPdfLib(filePath);

  const markInfo = deref(libDoc, libDoc.catalog.get(PDFName.of('MarkInfo')));
  const marked =
    markInfo instanceof PDFDict ? deref(libDoc, markInfo.get(PDFName.of('Marked'))) : undefined;
  const isTagged = String(marked) === 'true';

  const roots = walkStructTree(libDoc);

  if (!isTagged || !roots || roots.length === 0) {
    return {
      isTagged: false,
      lang: null,
      elements: [],
      note:
        'This document is not tagged (no MarkInfo/Marked=true or no reachable StructTreeRoot), ' +
        'so its logical content order cannot be determined. ISO 32000-2 §14.8.2.5 defines logical ' +
        'content order as a depth-first traversal of the structure hierarchy; without one, any ' +
        'ordering would be inferred from coordinates and could not be trusted. ' +
        'To add a structure scaffold, use pdf-writer-mcp `ensure_tagged`, then retry.',
    };
  }

  const langEntry = deref(libDoc, libDoc.catalog.get(PDFName.of('Lang')));
  const lang =
    langEntry instanceof PDFString || langEntry instanceof PDFHexString
      ? langEntry.decodeText()
      : null;

  const jsDoc = await loadDocument(filePath);
  try {
    const idToText = await buildDocumentIdToTextMap(jsDoc);

    // Map page object numbers (what /Pg holds) to 1-based page numbers.
    const pageNumByObjNum = new Map<number, number>();
    const pages = libDoc.getPages();
    for (let i = 0; i < pages.length; i++) {
      pageNumByObjNum.set(pages[i].ref.objectNumber, i + 1);
    }

    const pageFilter = options.pages
      ? resolvePageNumbers(options.pages, jsDoc.numPages)
      : undefined;

    return {
      isTagged: true,
      lang,
      elements: buildStructuredText(roots, idToText, pageNumByObjNum, {
        roles: options.roles,
        pages: pageFilter,
      }),
    };
  } finally {
    await jsDoc.destroy();
  }
}
