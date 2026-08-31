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
  asArray,
  asDict,
  asRef,
  get,
  nameOf,
  numberOf,
  resolved,
  textOf,
} from '@normativepdf/recover';
import type { CosDict, CosObject, CosRef, PdfDocument } from 'normativepdf';

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
  /**
   * The `/BBox` layout attribute, as four numbers in default user space, or
   * `null` when the element declares none.
   *
   * ISO 32000-2 Table 379: "An array of four numbers in default user space units
   * that shall give the coordinates of the left, bottom, right, and top edges …
   * of the structure element's bounding box (the rectangle that completely
   * encloses its visible content)."
   *
   * This is what the *file says*, not what was measured. It is not inheritable,
   * so an element that declares none has none — no ancestor's value applies.
   */
  layoutBBox: number[] | null;
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

/**
 * Resolve a value that may be an indirect reference.
 *
 * 読めなかったときは `null` に畳む。pdf-lib 版の `context.lookup` は投げるか
 * `undefined` を返していたので、ここは同じ範囲である —— **読めなかったことを
 * 申告したい場所ではこれを使わない**（`tryResolve` が `unreadable` を返す）。
 */
export async function deref(
  doc: PdfDocument,
  obj: CosObject | undefined,
): Promise<CosObject | null> {
  return resolved(doc, obj);
}

/**
 * Read a text-ish value (a string object) from a dictionary.
 *
 * **鍵が導けなかった文書は何も返さない。** ISO 32000-2 §7.6.2 が暗号化するのは
 * *文字列とストリーム*だけなので、構造木そのものは歩ける —— 名前も数も参照も
 * 平文である —— が、その中の文字列は暗号文である。
 *
 * 暗号文をそのまま返すのは、何も返さないより悪い: `PDF32000_2008.pdf`
 * （所有者パスワードつき・どの閲覧器でも読める）で数えると、木は
 * `/ActualText` を **18026 件**持ち、そのどれもが読めないバイト列だった。
 * #18 以降そのエントリはページの文字を*置き換える*ので、そういう文書すべての
 * 本文が化けることになる。
 *
 * 🔴 **見るのは「暗号化されているか」ではなく「鍵が導けたか」である**
 * （S3・2026-08-31 に直した）。pdf-lib は `ignoreEncryption` で開いていて
 * 復号しなかったので、`/Encrypt` があれば必ず暗号文だった。recover は鍵が
 * 導ければ復号する（ADR-0008）ので、利用者パスワードが空の文書では
 * `/ActualText` は平文で返る。`scope.encrypted` で切ると、読めている文字を
 * 捨てたうえで `search_text` が「見つからなかった」と自信を持って答える ——
 * 実測 `tests/fixtures/encrypted-actualtext.pdf` の "Difficult"。
 */
async function textEntry(
  doc: PdfDocument,
  lockedOut: boolean,
  dict: CosDict,
  key: string,
): Promise<string | null> {
  if (lockedOut) return null;
  return textOf(await resolved(doc, get(dict, key)));
}

// ─── Layout attributes (Issue #20, stage 2) ─────────────────────────────────

/**
 * The owner of the standard *layout* attributes (§14.8.5.4). `BBox` is one of
 * them, so it is only read from an attribute object that claims that owner:
 * a `/BBox` under some other `/O` belongs to that owner's vocabulary, and
 * reading it anyway would be borrowing a key across namespaces.
 */
const LAYOUT_OWNER = 'Layout';

/**
 * 構造木を降りる深さの上限。
 *
 * 🔴 参照番号の見張り（下の `ancestors`）だけでは足りない。**直接オブジェクトで
 * 書かれた枝は番号を持たない**ので見張りに載らず、そこに循環があると止まらない。
 * 止まらないのは例外ではないので、try/catch にも試験の timeout にも掛からない ——
 * マイクロタスクが詰まってタイマーすら動かず、サーバごと応答しなくなる
 * （0.14.0 の `render_page` と同じ形）。
 *
 * 200 は §14.7 の木としては十分深い。PDF/UA の実文書はふつう 20 を超えない。
 */
const MAX_STRUCT_DEPTH = 200;

async function bboxOfAttributeObject(
  doc: PdfDocument,
  value: CosObject | null | undefined,
): Promise<number[] | null> {
  const dict = asDict(await resolved(doc, value ?? undefined));
  if (!dict) return null;
  if (nameOf(await resolved(doc, get(dict, 'O'))) !== LAYOUT_OWNER) return null;

  const bbox = asArray(await resolved(doc, get(dict, 'BBox')));
  if (bbox?.items.length !== 4) return null;

  const numbers: number[] = [];
  for (const item of bbox.items) {
    const n = numberOf(await resolved(doc, item));
    if (n === null || !Number.isFinite(n)) return null;
    numbers.push(n);
  }
  return numbers;
}

/**
 * Read the `/BBox` layout attribute of one structure element.
 *
 * `/A` holds "either a single attribute object or an array of at least one
 * object" (§14.7.6.1), and in the array form attribute objects are interleaved
 * with revision numbers (§14.7.6.3) — integers, which are skipped here. When the
 * same attribute appears more than once, "the later (in array order) entry shall
 * take precedence", so the array is scanned front to back and the last hit wins.
 *
 * `/C` names attribute classes resolved through the structure tree root's
 * `/ClassMap` (§14.7.6.2). `/A` beats `/C`: "If both the A and C entries are
 * present and a given attribute is specified by both, the one specified by the A
 * entry shall take precedence."
 */
async function layoutBBoxOf(
  doc: PdfDocument,
  dict: CosDict,
  classMap: CosDict | null,
): Promise<number[] | null> {
  const fromEntry = async (
    value: CosObject | undefined,
    resolve: (v: CosObject) => Promise<CosObject | null>,
  ): Promise<number[] | null> => {
    const entry = await resolved(doc, value);
    const array = asArray(entry);
    const candidates: (CosObject | null)[] = array ? [...array.items] : [entry];
    let found: number[] | null = null;
    for (const candidate of candidates) {
      if (candidate === null) continue;
      // Revision numbers sit between the objects; they are not attribute objects.
      if (numberOf(await resolved(doc, candidate)) !== null) continue;
      const bbox = await bboxOfAttributeObject(doc, await resolve(candidate));
      if (bbox) found = bbox;
    }
    return found;
  };

  const fromA = await fromEntry(get(dict, 'A'), async (v) => v);
  if (fromA) return fromA;

  if (!classMap) return null;
  return fromEntry(get(dict, 'C'), async (name) => {
    const named = nameOf(await resolved(doc, name));
    return named === null ? null : (get(classMap, named) ?? null);
  });
}

/** Normalise `/K` — it may be absent, a single object, or an array. */
async function kidsOf(doc: PdfDocument, dict: CosDict): Promise<CosObject[]> {
  // 🔴 `/K` の**生の値**も要る。要素が参照なら、その参照番号が巡回の見張りになる
  // （recover の resolve は呼ぶたびに値を作るので、オブジェクト同一性では止まらない）。
  const raw = get(dict, 'K');
  const array = asArray(raw);
  if (array) return [...array.items];
  const k = await resolved(doc, raw);
  if (k === null) return [];
  const resolvedArray = asArray(k);
  if (resolvedArray) return [...resolvedArray.items];
  // 参照 1 個のときは、番号を残すために生の値を返す
  return [raw ?? k];
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
async function walkElement(
  doc: PdfDocument,
  lockedOut: boolean,
  dict: CosDict,
  inheritedPg: CosRef | undefined,
  classMap: CosDict | null,
  /**
   * この要素までに通った参照番号（**この枝の祖先だけ**）。
   *
   * 🔴 pdf-lib 版には巡回の見張りが無く、`/K` が循環している文書では
   * 再帰が止まらなかった。番号で見張るのは、recover の `resolve` が呼ぶたびに
   * 値を作るのでオブジェクト同一性では止まらないためである（verify で同じ轍）。
   * 木全体ではなく**枝**で見張るので、非循環の文書では出力が 1 バイトも変わらない。
   */
  ancestors: ReadonlySet<number>,
  depth: number,
): Promise<StructElement | null> {
  if (depth > MAX_STRUCT_DEPTH) return null;
  const role = nameOf(await resolved(doc, get(dict, 'S')));
  if (role === null) return null;

  const pg = asRef(get(dict, 'Pg')) ?? inheritedPg;

  const element: StructElement = {
    role,
    actualText: await textEntry(doc, lockedOut, dict, 'ActualText'),
    alt: await textEntry(doc, lockedOut, dict, 'Alt'),
    lang: await textEntry(doc, lockedOut, dict, 'Lang'),
    contentRefs: [],
    children: [],
    layoutBBox: await layoutBBoxOf(doc, dict, classMap),
  };

  for (const kid of await kidsOf(doc, dict)) {
    // An MCID written directly, on this element's page.
    const direct = numberOf(kid);
    if (direct !== null) {
      if (pg) element.contentRefs.push({ pageObjNum: pg.objectNumber, mcid: direct });
      continue;
    }

    const kidRef = asRef(kid);
    const child = asDict(await resolved(doc, kid));
    if (!child) continue;

    const typeName = nameOf(get(child, 'Type'));

    if (typeName === 'MCR') {
      const mcid = numberOf(await resolved(doc, get(child, 'MCID')));
      const mcrPg = asRef(get(child, 'Pg')) ?? pg;
      if (mcid !== null && mcrPg) {
        element.contentRefs.push({ pageObjNum: mcrPg.objectNumber, mcid });
      }
      continue;
    }

    // OBJR points at an annotation or form field, which carries no page text.
    if (typeName === 'OBJR') continue;

    // Anything with an /S is a child structure element. Checking /S rather than
    // Type == StructElem on purpose: Type is optional in practice and plenty of
    // producers omit it.
    if (get(child, 'S') !== undefined) {
      if (kidRef && ancestors.has(kidRef.objectNumber)) continue; // 循環（§14.7.2 は木を求める）
      const next = kidRef ? new Set(ancestors).add(kidRef.objectNumber) : ancestors;
      const walked = await walkElement(doc, lockedOut, child, pg, classMap, next, depth + 1);
      if (walked) element.children.push(walked);
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
 *
 * @param lockedOut 暗号化されていて鍵が導けなかった（`lockedOut(scope)`）。
 *                  木の形は歩けるが、その中の文字列は返さない（`textEntry`）。
 */
export async function walkStructTree(
  doc: PdfDocument,
  lockedOut: boolean,
): Promise<StructElement[] | null> {
  const catalog = asDict(await doc.getCatalog().catch(() => null));
  const root = asDict(await resolved(doc, get(catalog, 'StructTreeRoot')));
  if (!root) return null;

  // §14.7.6.2: attribute classes named by an element's /C are resolved through
  // the structure tree root's /ClassMap, so it has to be read before the walk.
  const classMap = asDict(await resolved(doc, get(root, 'ClassMap')));

  const elements: StructElement[] = [];
  for (const kid of await kidsOf(doc, root)) {
    const kidRef = asRef(kid);
    const child = asDict(await resolved(doc, kid));
    if (child && get(child, 'S') !== undefined) {
      const seed = new Set<number>(kidRef ? [kidRef.objectNumber] : []);
      const element = await walkElement(doc, lockedOut, child, undefined, classMap, seed, 0);
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
