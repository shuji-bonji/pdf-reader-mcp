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

import { asDict, boolOf, textOf as cosTextOf, get, resolved } from '@normativepdf/recover';
import { type CosDict, type PdfDocument, readPageTree } from 'normativepdf';
import type {
  ElementBox,
  ExtractedTable,
  ObjectRect,
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
  buildDocumentIdToBoxMap,
  buildDocumentIdToTextMap,
  compactCellText,
  LINE_BREAK,
  loadDocument,
  type MarkedContentExtent,
  type RunBox,
  resolveLineBreaks,
} from './pdfjs-service.js';
import { lockedOut, openPdf, pageBox } from './recover-service.js';
import {
  type ContentRef,
  collectContentRefs,
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

// ─── Structure element → drawing rectangle (Issue #20, stage 2) ─────────────

/**
 * What every rectangle in the result does and does not mean.
 *
 * Returned with the result rather than left to the tool description, because
 * the rectangle is about to be handed to `add_annotation`, and the caller that
 * does the handing over is the one that has to know what it is holding.
 */
export const BBOX_NOTES: string[] = [
  'Rectangles are in PDF default user space: origin bottom-left, pt, normalised (x1 < x2, ' +
    'y1 < y2). This is the same space pdf-writer-mcp add_annotation takes, and it is not ' +
    'affected by /Rotate or by a /CropBox whose origin is not (0, 0).',
  'basis "text-extent" is measured from the element\'s text only. The vertical edges come ' +
    "from the font's ascent and descent times the run's size — the line box, not the glyph " +
    'outlines, so a glyph that overshoots can exceed it. Images and vector drawings ' +
    'contribute nothing at all.',
  'basis "layout-attribute-bbox" is the /BBox the file declares for the element ' +
    '(ISO 32000-2 Table 379). It is a declaration, not a measurement — reported as the ' +
    'file states it, and files do state nonsense. It is cross-checked against the page box ' +
    "and against the element's own text; read boxNote before passing one to add_annotation.",
  'An element with no rectangle carries boxNote saying why. Absent is not the same as ' +
    'zero-sized, and neither is guessed at.',
];

/**
 * Normalise a rectangle written as two opposite corners.
 *
 * ISO 32000-2 §7.9.5 allows the corners in either order and requires
 * normalisation before use; `add_annotation` requires `x1 < x2`, `y1 < y2`, so
 * this is what makes the rectangle directly usable there. Same treatment as
 * `locate_objects` (stage 1) gives `/Rect`, deliberately: the two stages must
 * hand over the same shape.
 */
function normaliseRect(values: number[]): ObjectRect | null {
  if (values.length !== 4 || values.some((v) => !Number.isFinite(v))) return null;
  const [a, b, c, d] = values;
  return { x1: Math.min(a, c), y1: Math.min(b, d), x2: Math.max(a, c), y2: Math.max(b, d) };
}

function rectOfRunBox(box: RunBox): ObjectRect {
  return { x1: box.minX, y1: box.minY, x2: box.maxX, y2: box.maxY };
}

/** Does `outer` contain `inner`, allowing a small slack for rounding? */
function contains(outer: ObjectRect, inner: ObjectRect, slack = 1): boolean {
  return (
    inner.x1 >= outer.x1 - slack &&
    inner.y1 >= outer.y1 - slack &&
    inner.x2 <= outer.x2 + slack &&
    inner.y2 <= outer.y2 + slack
  );
}

/** The measured extent of an element's text, per page, plus what went unmeasured. */
function measureText(
  element: StructElement,
  idToBox: Map<string, MarkedContentExtent>,
  pageNumByObjNum: Map<number, number>,
): { byPage: Map<number, RunBox>; sawUnmeasurable: boolean; sawContent: boolean } {
  const byPage = new Map<number, RunBox>();
  let sawUnmeasurable = false;
  let sawContent = false;

  for (const ref of collectContentRefs(element)) {
    sawContent = true;
    const extent = idToBox.get(pdfjsMarkedContentId(ref));
    if (!extent) continue;
    if (extent.hasUnmeasurableRun) sawUnmeasurable = true;
    if (!extent.box) continue;
    const pageNum = pageNumByObjNum.get(ref.pageObjNum);
    if (pageNum === undefined) continue;
    const current = byPage.get(pageNum);
    byPage.set(
      pageNum,
      current
        ? {
            minX: Math.min(current.minX, extent.box.minX),
            minY: Math.min(current.minY, extent.box.minY),
            maxX: Math.max(current.maxX, extent.box.maxX),
            maxY: Math.max(current.maxY, extent.box.maxY),
          }
        : { ...extent.box },
    );
  }

  return { byPage, sawUnmeasurable, sawContent };
}

/**
 * Where an element is drawn, and what that rectangle does not cover.
 *
 * Two bases, and they are not the same kind of claim:
 *
 *  - **`layout-attribute-bbox`** — the `/BBox` the file declares (Table 379).
 *    It is the producer's statement about its own geometry. Preferred when
 *    present, because it is the only source that can describe content with no
 *    text: a `Figure` holding one image has an MCID but no text runs, so
 *    nothing can be measured for it. §14.8.4.8.5 says a Figure "should have a
 *    BBox attribute" for exactly this reason.
 *  - **`text-extent`** — measured from the runs the element owns. Real, but
 *    only of the *text*: images and vector art contribute nothing to it.
 *
 * When both exist and the declared rectangle does not cover the measured one,
 * that disagreement is reported rather than smoothed over. A declaration that
 * does not match what is drawn is a finding, not a rounding error.
 */
function boxesOf(
  element: StructElement,
  idToBox: Map<string, MarkedContentExtent>,
  pageNumByObjNum: Map<number, number>,
  pageBoxByNumber: Map<number, ObjectRect>,
): { boxes: ElementBox[]; note?: string } {
  const { byPage, sawUnmeasurable, sawContent } = measureText(element, idToBox, pageNumByObjNum);
  const pages = pagesOf(element, pageNumByObjNum);

  const declared = element.layoutBBox ? normaliseRect(element.layoutBBox) : null;
  if (declared && pages.length > 0) {
    const page = pages[0];
    const boxes: ElementBox[] = [{ page, rect: declared, basis: 'layout-attribute-bbox' }];
    const complaints: string[] = [];

    // Does the declaration reach outside the page it is on? Table 379 defines
    // BBox as enclosing the element's *visible* content, and content outside the
    // crop box is not visible (§7.7.3.3), so a rectangle that leaves the page
    // cannot be the one that clause describes.
    //
    // This is not hypothetical. `-32768 -32768 32767 32767` — a producer writing
    // int16 sentinels instead of a rectangle — is present on the cover Figure of
    // BOTH Well-Tagged PDF 1.0 and the Tagged PDF Best Practice Guide, and
    // PDF32000_2008 has 131 of its 545 declarations reaching past the page edge.
    // Handed to add_annotation unqualified, the first of those draws over the
    // entire coordinate space.
    const pageBox = pageBoxByNumber.get(page);
    if (pageBox && !contains(pageBox, declared)) {
      const box = [pageBox.x1, pageBox.y1, pageBox.x2, pageBox.y2]
        .map((v) => v.toFixed(1))
        .join(', ');
      complaints.push(
        `it reaches outside page ${page}, whose box is (${box}) — so it cannot be the ` +
          "rectangle enclosing the element's visible content. Do NOT pass it to " +
          'add_annotation without checking it',
      );
    }

    const measured = byPage.get(page);
    if (measured && !contains(declared, rectOfRunBox(measured))) {
      complaints.push(
        'it does not cover the text measured inside the element ' +
          `(measured on page ${page}: ` +
          `${[measured.minX, measured.minY, measured.maxX, measured.maxY]
            .map((v) => v.toFixed(1))
            .join(', ')})`,
      );
    }

    if (complaints.length > 0) {
      return {
        boxes,
        note:
          `The /BBox this element declares is reported as-is, but ${complaints.join('; and ')}. ` +
          'It is what the file says, not what was measured.',
      };
    }
    return { boxes };
  }

  if (sawUnmeasurable) {
    return {
      boxes: [],
      note:
        'Some of this element is drawn in vertical writing mode, whose advance direction ' +
        'this measurement does not resolve. A rectangle covering only the horizontal part ' +
        'would be wrong rather than absent, so none is reported. A /BBox layout attribute ' +
        '(ISO 32000-2 Table 379) would settle it.',
    };
  }

  const boxes: ElementBox[] = [];
  for (const page of pages) {
    const box = byPage.get(page);
    if (box) boxes.push({ page, rect: rectOfRunBox(box), basis: 'text-extent' });
  }

  if (boxes.length > 0) return { boxes };

  return {
    boxes: [],
    note: sawContent
      ? 'No text was measured inside this element, so its extent could not be derived. ' +
        'Images and vector drawings are not measured — a Figure that holds one image is ' +
        'the usual case, and ISO 32000-2 §14.8.4.8.5 says such an element "should have a ' +
        'BBox attribute". This one declares none.'
      : 'This element owns no marked content of its own or in its descendants, so there is ' +
        'nothing on a page to measure.',
  };
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
  idToBox: Map<string, MarkedContentExtent> | null,
  pageBoxByNumber: Map<number, ObjectRect>,
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

  if (idToBox) {
    const { boxes, note } = boxesOf(element, idToBox, pageNumByObjNum, pageBoxByNumber);
    if (boxes.length > 0) entry.boxes = boxes;
    if (note) entry.boxNote = note;
  }

  out.push(entry);

  // Table rows and LI bodies are already represented; don't emit them again.
  if (isTable || element.role === 'LI') return;

  for (const child of element.children) {
    flatten(child, depth + 1, idToText, pageNumByObjNum, out, idToBox, pageBoxByNumber);
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
  options: {
    roles?: string[];
    pages?: number[];
    idToBox?: Map<string, MarkedContentExtent> | null;
    pageBoxByNumber?: Map<number, ObjectRect>;
  } = {},
): StructuredElement[] {
  const out: StructuredElement[] = [];
  const pageBoxes = options.pageBoxByNumber ?? new Map<number, ObjectRect>();
  for (const root of roots) {
    flatten(root, 0, idToText, pageNumByObjNum, out, options.idToBox ?? null, pageBoxes);
  }

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
/**
 * `/MarkInfo` `/Marked`（§14.7.1）。**true と書かれているかだけ**を見る。
 *
 * pdf-lib 版は `String(deref(...)) === 'true'` だった。`PDFBool` の文字列表現に
 * 頼っていたので、`/Marked` が数や名前でも `"true"` と綴られていれば通っていた。
 * ここは真理値として読む —— 条文が求めているのは boolean である。
 */
/**
 * `/Pg` が持つページのオブジェクト番号 → 1 始まりのページ番号。
 *
 * 頁ツリーが歩けない文書では**空の対応表**を返す。pdf-lib 版の `getPages()` は
 * そこで投げていたので、呼び出し側は例外で気づいていた。ここは空で返るので、
 * `/Pg` はどのページにも当たらない —— 間違ったページに当てるよりよい。
 */
async function pageNumberByObjectNumber(doc: PdfDocument): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const tree = await readPageTree(doc).catch(() => null);
  if (!tree) return map;
  for (const page of tree.pages) {
    if (page.ref) map.set(page.ref.objectNumber, page.index + 1);
  }
  return map;
}

async function isMarked(doc: PdfDocument, catalog: CosDict | null): Promise<boolean> {
  const markInfo = asDict(await resolved(doc, get(catalog, 'MarkInfo')));
  return boolOf(await resolved(doc, get(markInfo, 'Marked'))) === true;
}

export async function analyzeTags(filePath: string): Promise<TagsAnalysis> {
  const { doc, scope } = await openPdf(filePath);
  const catalog = asDict(await doc.getCatalog().catch(() => null));
  const isTagged = await isMarked(doc, catalog);
  return analyzeTagsFromStructTree(await walkStructTree(doc, lockedOut(scope)), isTagged);
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
  options: { pages?: string; roles?: string[]; includeBbox?: boolean } = {},
): Promise<StructuredTextResult> {
  const { doc: libDoc, scope } = await openPdf(filePath);

  const catalog = asDict(await libDoc.getCatalog().catch(() => null));
  const isTagged = await isMarked(libDoc, catalog);

  const roots = await walkStructTree(libDoc, lockedOut(scope));

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

  const lang = cosTextOf(await resolved(libDoc, get(catalog, 'Lang')));

  const jsDoc = await loadDocument(filePath);
  try {
    const idToText = await buildDocumentIdToTextMap(jsDoc);

    // Map page object numbers (what /Pg holds) to 1-based page numbers.
    const pageNumByObjNum = await pageNumberByObjectNumber(libDoc);

    const pageFilter = options.pages
      ? resolvePageNumbers(options.pages, jsDoc.numPages)
      : undefined;

    const idToBox = options.includeBbox ? await buildDocumentIdToBoxMap(jsDoc) : null;

    // Page boxes, so a declared /BBox can be checked against the page it claims
    // to be on. `pageBox` は locate_objects と**同じ 1 本**で、CropBox → MediaBox の
    // 落ち方（§7.7.3.4）まで揃えてある。2 つの段が「そのページ」で食い違わないため。
    const pageBoxByNumber = new Map<number, ObjectRect>();
    if (options.includeBbox) {
      const tree = await readPageTree(libDoc).catch(() => null);
      for (const page of tree?.pages ?? []) {
        // 箱の読めないページは照合しないだけ。宣言そのものは報告する。
        const box = await pageBox(libDoc, page);
        if (box) pageBoxByNumber.set(page.index + 1, box);
      }
    }

    return {
      isTagged: true,
      lang,
      elements: buildStructuredText(roots, idToText, pageNumByObjNum, {
        roles: options.roles,
        pages: pageFilter,
        idToBox,
        pageBoxByNumber,
      }),
      ...(options.includeBbox ? { bboxNotes: BBOX_NOTES } : {}),
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
  const { doc: libDoc, scope } = await openPdf(filePath);

  const catalog = asDict(await libDoc.getCatalog().catch(() => null));
  const isTagged = await isMarked(libDoc, catalog);

  const roots = await walkStructTree(libDoc, lockedOut(scope));

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
    const pageNumByObjNum = await pageNumberByObjectNumber(libDoc);

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
