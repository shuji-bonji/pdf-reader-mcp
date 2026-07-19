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

import { PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import type {
  ExtractedTable,
  StructuredElement,
  StructuredTableCell,
  StructuredTextResult,
  TableRow,
  TablesExtractionResult,
  TagNode,
  TagsAnalysis,
} from '../types.js';
import { resolvePageNumbers } from '../utils/pdf-helpers.js';
import {
  buildDocumentIdToTextMap,
  compactCellText,
  LINE_BREAK,
  loadDocument,
  resolveLineBreaks,
} from './pdfjs-service.js';
import { loadWithPdfLib } from './pdflib-service.js';
import {
  type ContentRef,
  collectContentRefs,
  deref,
  pdfjsMarkedContentId,
  type StructElement,
  walkStructTree,
} from './struct-tree-walker.js';

// The walk itself now lives in `struct-tree-walker` (pdf-lib only, no pdfjs) so
// that `actual-text-service` can use it without a circular import. Re-exported
// here because this module is the published entry point for structure work.
export {
  type ContentRef,
  collectContentRefs,
  pdfjsMarkedContentId,
  type StructElement,
  walkStructTree,
};

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

// ─── extract_tables (#14) ───────────────────────────────────────────────────

/**
 * Collect every top-level `Table` element in logical content order.
 *
 * Nested tables are not emitted as separate tables (parity with the previous
 * implementation) — their text still appears inside the enclosing cell.
 */
function collectTableElements(
  elements: StructElement[],
  into: StructElement[] = [],
): StructElement[] {
  for (const element of elements) {
    if (element.role === 'Table') {
      into.push(element);
      continue;
    }
    collectTableElements(element.children, into);
  }
  return into;
}

/** Split a `Table` element's rows into THead / TBody / TFoot sections. */
function tableRowsBySection(
  table: StructElement,
  idToText: Map<string, string>,
): { headerRows: TableRow[]; bodyRows: TableRow[]; footerRows: TableRow[] } {
  const headerRows: TableRow[] = [];
  const bodyRows: TableRow[] = [];
  const footerRows: TableRow[] = [];

  const rowFrom = (tr: StructElement): TableRow | null => {
    const cells = tr.children
      .filter((c) => c.role === 'TH' || c.role === 'TD')
      .map((c) => ({
        // Same cell treatment as before the walker swap: CJK-aware line-break
        // resolution, whitespace collapse, kerning fold, Markdown escaping.
        // textOf additionally honours /ActualText (§14.9.4), which the old
        // per-page walk did not.
        text: compactCellText(textOf(c, idToText, true)),
        isHeader: c.role === 'TH',
      }));
    return cells.length === 0 ? null : { cells };
  };

  const appendRows = (section: StructElement, into: TableRow[]): void => {
    for (const child of section.children) {
      if (child.role === 'TR') {
        const row = rowFrom(child);
        if (row) into.push(row);
      }
    }
  };

  for (const child of table.children) {
    if (child.role === 'THead') appendRows(child, headerRows);
    else if (child.role === 'TBody') appendRows(child, bodyRows);
    else if (child.role === 'TFoot') appendRows(child, footerRows);
    else if (child.role === 'TR') {
      // Tables sometimes omit THead/TBody and place TRs directly under <Table>.
      const row = rowFrom(child);
      if (row) bodyRows.push(row);
    }
  }

  return { headerRows, bodyRows, footerRows };
}

/**
 * Extract every `<Table>` subtree as structured rows/cells (#14).
 *
 * Walks the document's `StructTreeRoot` once — the same walker as
 * `extract_structured_text` and `inspect_tags` (C-1) — so a Table StructElem
 * that continues across a page break stays ONE table with `pages: [..]`.
 *
 * The previous implementation merged per-page `page.getStructTree()` trees.
 * That sliced a page-spanning Table into per-page fragments and emitted
 * "phantom" tables (a lone empty header cell) on pages that carried only the
 * element's Figures — observed on ISO 32000-2 pp.383–386, where the per-page
 * walk reported 7 tables for what the structure tree holds as 4.
 *
 * The `pages` argument filters by touch: a table that touches the range is
 * returned whole, and `index` is assigned in document order before filtering
 * so the same table keeps the same index whatever the filter.
 */
export async function extractTables(
  filePath: string,
  pages?: string,
): Promise<TablesExtractionResult> {
  const libDoc = await loadWithPdfLib(filePath);

  const markInfo = deref(libDoc, libDoc.catalog.get(PDFName.of('MarkInfo')));
  const marked =
    markInfo instanceof PDFDict ? deref(libDoc, markInfo.get(PDFName.of('Marked'))) : undefined;
  const isTagged = String(marked) === 'true';

  const roots = walkStructTree(libDoc);

  if (!isTagged || !roots || roots.length === 0) {
    return {
      isTagged: false,
      tables: [],
      totalTables: 0,
      pagesScanned: 0,
      note:
        'Document is not tagged. extract_tables relies on /MarkInfo /Marked true ' +
        'and a StructTree. For untagged two-column PDFs, fall back to a ' +
        'column-aware reading strategy (see pdf-reader-mcp Issue #3).',
    };
  }

  const jsDoc = await loadDocument(filePath);
  try {
    const idToText = await buildDocumentIdToTextMap(jsDoc);

    // Map page object numbers (what /Pg holds) to 1-based page numbers.
    const pageNumByObjNum = new Map<number, number>();
    const libPages = libDoc.getPages();
    for (let i = 0; i < libPages.length; i++) {
      pageNumByObjNum.set(libPages[i].ref.objectNumber, i + 1);
    }

    const pageNumbers = resolvePageNumbers(pages, jsDoc.numPages);
    const wanted = pages ? new Set(pageNumbers) : undefined;

    const tables: ExtractedTable[] = [];
    const tableElements = collectTableElements(roots);
    for (const [i, element] of tableElements.entries()) {
      const tablePages = pagesOf(element, pageNumByObjNum);
      if (wanted && tablePages.length > 0 && !tablePages.some((p) => wanted.has(p))) continue;
      const { headerRows, bodyRows, footerRows } = tableRowsBySection(element, idToText);
      tables.push({ pages: tablePages, index: i + 1, headerRows, bodyRows, footerRows });
    }

    return {
      isTagged: true,
      tables,
      totalTables: tables.length,
      pagesScanned: pageNumbers.length,
    };
  } finally {
    await jsDoc.destroy();
  }
}
