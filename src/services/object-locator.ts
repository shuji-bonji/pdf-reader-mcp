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
  asArray,
  asDict,
  asRef,
  nameOf as cosNameOf,
  get,
  numberOf,
  refKey,
  resolved,
  textOf,
} from '@normativepdf/recover';
import {
  type CosDict,
  type CosObject,
  type CosRef,
  inheritedAttribute,
  type PageEntry,
  type PdfDocument,
  readPageTree,
} from 'normativepdf';
import type { LocatedObject, ObjectLocation, ObjectLocationResult, ObjectRect } from '../types.js';
import { lockedOut, openPdf } from './recover-service.js';

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

async function numberArray(
  doc: PdfDocument,
  value: CosObject | undefined,
): Promise<number[] | null> {
  const array = asArray(await resolved(doc, value));
  if (!array) return null;
  const numbers: number[] = [];
  for (const item of array.items) {
    const n = numberOf(await resolved(doc, item));
    if (n === null) return null;
    numbers.push(n);
  }
  return numbers;
}

/** 名前を引く。**参照は解決しない** —— pdf-lib 版の `dict.get()` と同じ範囲である。 */
function nameOf(dict: CosDict | null, key: string): string | null {
  return cosNameOf(get(dict, key));
}

/**
 * ページの矩形。**pdf-lib の `getCropBox()` と同じ順で決める**（A/B のため）:
 *
 *   1. 継承込みの `/CropBox` が 4 要素の数の配列なら、それ
 *   2. 配列でない・無いなら `/MediaBox` へ落ちる
 *   3. `/CropBox` が配列だが 4 要素でない、または数でない要素を含むなら、
 *      pdf-lib は `asRectangle()` が投げて **`/MediaBox` へは落ちない**。矩形は付かない
 *
 * 🔴 正規化しない。pdf-lib の `asRectangle` は `{x: llx, width: urx - llx}` を返し、
 * 呼び出し側が `x2 = x + width` に戻すので、逆順の矩形は逆順のまま出ていた。
 */
async function pageBox(doc: PdfDocument, page: PageEntry): Promise<ObjectRect | null> {
  const crop = await resolved(doc, inheritedAttribute(page, 'CropBox'));
  const cropArray = asArray(crop);
  if (cropArray) {
    const values = await numberArray(doc, crop ?? undefined);
    // 4 要素の数でなければ pdf-lib は投げる —— MediaBox へは落ちない
    if (values === null || values.length !== 4) return null;
    return { x1: values[0], y1: values[1], x2: values[2], y2: values[3] };
  }
  const media = await numberArray(doc, inheritedAttribute(page, 'MediaBox'));
  if (media === null || media.length !== 4) return null;
  return { x1: media[0], y1: media[1], x2: media[2], y2: media[3] };
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

async function buildPageIndex(doc: PdfDocument): Promise<PageIndex> {
  const index: PageIndex = {
    pageNumberByRef: new Map(),
    boxByPage: new Map(),
    annotationPages: new Map(),
    contentPages: new Map(),
    resourcePages: new Map(),
  };

  // 歩けない頁ツリー（壊れた木・目録に届かない文書）では索引を空のまま返す。
  // オブジェクトは「ページの分からない場所」に落ち、間違ったページには着かない。
  const tree = await readPageTree(doc).catch(() => null);
  if (!tree) return index;

  for (const page of tree.pages) {
    const pageNumber = page.index + 1;
    // 直接オブジェクトの頁は参照を持たない。索引には載せられないが、番号は数える。
    if (page.ref) index.pageNumberByRef.set(refKey(page.ref), pageNumber);

    const box = await pageBox(doc, page);
    if (box) index.boxByPage.set(pageNumber, box);

    const node = page.dict;

    const annots = await resolved(doc, get(node, 'Annots'));
    const annotsArray = asArray(annots);
    if (annotsArray) {
      for (const entry of annotsArray.items) {
        const ref = asRef(entry);
        if (ref) push(index.annotationPages, refKey(ref), pageNumber);
      }
    }

    const contents = get(node, 'Contents');
    const contentsRef = asRef(contents);
    if (contentsRef) {
      push(index.contentPages, refKey(contentsRef), pageNumber);
    } else {
      const contentsArray = asArray(contents);
      if (contentsArray) {
        for (const entry of contentsArray.items) {
          const ref = asRef(entry);
          if (ref) push(index.contentPages, refKey(ref), pageNumber);
        }
      }
    }

    // 🔴 継承は辿らない —— pdf-lib 版は `node.get(Resources)` で、
    // `PDFPageLeaf.Resources()` の継承つきの読みは使っていなかった。
    const resourcesValue = get(node, 'Resources');
    const resources = asDict(await resolved(doc, resourcesValue));
    if (resources) {
      const resourcesRef = asRef(resourcesValue);
      if (resourcesRef) push(index.resourcePages, refKey(resourcesRef), pageNumber);
      for (const category of RESOURCE_CATEGORIES) {
        const groupValue = get(resources, category);
        const group = asDict(await resolved(doc, groupValue));
        if (!group) continue;
        const groupRef = asRef(groupValue);
        if (groupRef) push(index.resourcePages, refKey(groupRef), pageNumber);
        for (const [, value] of group.entries) {
          const ref = asRef(value);
          if (ref) push(index.resourcePages, refKey(ref), pageNumber);
        }
      }
    }
  }

  return index;
}

/** Page number an annotation names through `/P`, when it names one. */
function pageFromAnnotationParent(dict: CosDict, index: PageIndex): number | null {
  const parent = asRef(get(dict, 'P'));
  if (!parent) return null;
  return index.pageNumberByRef.get(refKey(parent)) ?? null;
}

async function locateDict(
  doc: PdfDocument,
  ref: CosRef,
  dict: CosDict,
  index: PageIndex,
): Promise<{ locations: ObjectLocation[]; reason: string | null }> {
  const locations: ObjectLocation[] = [];
  const type = nameOf(dict, 'Type');

  // 1. Anything carrying a /Rect states its own rectangle. Annotations are the
  //    case that matters: this is the coordinate add_annotation wants.
  const rect = normaliseRect((await numberArray(doc, get(dict, 'Rect'))) ?? []);
  if (rect) {
    const pages =
      index.annotationPages.get(refKey(ref)) ??
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
  const asPage = index.pageNumberByRef.get(refKey(ref));
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
  const { doc, scope } = await openPdf(filePath);
  const index = await buildPageIndex(doc);
  const notes: string[] = [];

  // 🔴 訊かれた番号だけを引く。全部を数え上げると、訊かれていないオブジェクトの
  // 読めなさが「読めなかった数」に混ざり、どの番号の話か分からなくなる。
  const byNumber = new Map<number, { ref: CosRef; object: CosObject }>();
  const unreadable = new Map<number, string>();
  /** 表が名指ししているが、値が null オブジェクトだった番号（§7.3.9）。 */
  const nullValued = new Set<number>();
  for (const objectNumber of new Set(objectNumbers)) {
    const entry = doc.xref.get(objectNumber);
    if (!entry || entry.type === 'free' || entry.type === 'unknown') continue;
    const generation = entry.type === 'in-use' ? entry.generation : 0;
    try {
      const object = await doc.getObject(objectNumber, generation);
      if (object.kind === 'null') {
        nullValued.add(objectNumber);
        continue;
      }
      byNumber.set(objectNumber, {
        ref: { kind: 'ref', objectNumber, generationNumber: generation },
        object,
      });
    } catch (error) {
      // normativepdf のエラーは条文を名指しする。そのまま渡す —— 言い換えると
      // 「どの条文に反していて読めないのか」が消える。
      unreadable.set(objectNumber, String((error as Error)?.message ?? error));
    }
  }

  if (index.pageNumberByRef.size === 0) {
    notes.push(
      'The page tree could not be walked, so no object could be tied to a page number. ' +
        "Rectangles read from an object's own /Rect are still reported.",
    );
  }
  if (scope.encrypted) {
    notes.push(
      'The document is encrypted. Numbers and names are not encrypted (ISO 32000-1 §7.6.2), so ' +
        'coordinates and types are reliable, but strings are not decrypted here — field names are ' +
        'reported as null rather than as mojibake.',
    );
  }
  // 🔴 「そのオブジェクトが無い」と「そのオブジェクトを読みに行けなかった」は別である。
  // 鍵が導けない文書では 1 つも読めないので、found: false が全件に付く。
  // その理由をここで名指ししないと、freed されたオブジェクトと同じ顔になる。
  if (lockedOut(scope)) {
    notes.push(
      'The file encryption key could not be derived (ISO 32000-2 §7.6.4.3.2), so no indirect ' +
        'object could be read. Objects reported as not found were not looked at — this is not ' +
        'the same as an object freed by a later revision.',
    );
  }

  const objects: LocatedObject[] = [];
  for (const objectNumber of objectNumbers) {
    objects.push(
      await locateOne(doc, scope, index, byNumber, unreadable, nullValued, objectNumber),
    );
  }

  return { objects, isEncrypted: scope.encrypted, notes };
}

/**
 * 見つからなかったときの理由。**3 つを混ぜない。**
 *
 *   1. その番号のオブジェクトが無い（後の版が freed にした形）
 *   2. 鍵が導けないので、どのオブジェクトも読みに行けない（§7.6）
 *   3. 表は名指ししているが、そのオブジェクトが条文に反していて読めない
 *
 * 読み手にとって次にすることが 3 つとも違う。1 は「その版にはもう無い」、
 * 2 は「パスワードを渡す」、3 は「ファイルが壊れている・生成側の問題」。
 */
function notFoundReason(
  scope: { encrypted: boolean },
  why: string | undefined,
  nullValued: boolean,
): string {
  // 表がこの番号を載せていて、その値が null オブジェクトだった場合。
  // §7.3.9 は null を「他のどの値とも等しくない」と定め、存在しないオブジェクトへの
  // 間接参照は null と等価だと言う。だから「無い」で正しいが、
  // **表に載っていない**のとは別のことが起きている。
  if (nullValued) {
    return (
      'The cross-reference table names this object, but its value is the null object ' +
      '(ISO 32000-2 §7.3.9), which is equivalent to no object at all. The table has not been ' +
      'updated, or a later revision emptied the object without freeing its slot.'
    );
  }
  if (why === undefined) {
    return (
      'No object with this number exists in the document as parsed. An object freed by a ' +
      'later revision is expected to look like this.'
    );
  }
  // 🔴 ライブラリの文面をそのまま出さない。「parsePdf で開け」はこのツールの
  // 利用者にできることではない（ライブラリの内側の話である）。
  if (scope.encrypted) {
    return (
      'The cross-reference table names this object, but the file encryption key could not be ' +
      'derived (ISO 32000-2 §7.6.4.3.2), so no indirect object was read. Numbers and names are ' +
      'not encrypted (§7.6.2), but they cannot be reached without opening the document. ' +
      'Supply the user password. This is not an object freed by a later revision.'
    );
  }
  return (
    `The cross-reference table names this object, but it could not be read: ${why}. ` +
    'This is not an object freed by a later revision — it is a file the specification does ' +
    'not allow to be read this way.'
  );
}

async function locateOne(
  doc: PdfDocument,
  scope: { encrypted: boolean },
  index: PageIndex,
  byNumber: Map<number, { ref: CosRef; object: CosObject }>,
  unreadable: Map<number, string>,
  nullValued: Set<number>,
  objectNumber: number,
): Promise<LocatedObject> {
  {
    const hit = byNumber.get(objectNumber);
    if (!hit) {
      // 🔴 「この番号のオブジェクトは無い」と「この番号を読みに行って読めなかった」を
      // 同じ文で返さない。前者は後の版が freed にした形で、後者はファイルが
      // 条文に反している形である。読み手にとって次にすることが違う。
      const why = unreadable.get(objectNumber);
      return {
        objectNumber,
        generation: null,
        found: false,
        type: null,
        subtype: null,
        fieldName: null,
        locations: [],
        reason: notFoundReason(scope, why, nullValued.has(objectNumber)),
      };
    }

    const { ref, object } = hit;
    if (object.kind !== 'dict') {
      // ストリームは自分の辞書を持つ。それ以外（数・配列）は場所を持たない。
      const streamDict = object.kind === 'stream' ? object.dict : null;
      const contentPages = index.contentPages.get(refKey(ref)) ?? [];
      const resourcePages = index.resourcePages.get(refKey(ref)) ?? [];
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

    const { locations, reason } = await locateDict(doc, ref, object, index);
    let finalReason = reason;
    if (locations.length === 0) {
      const contentPages = index.contentPages.get(refKey(ref)) ?? [];
      const resourcePages = index.resourcePages.get(refKey(ref)) ?? [];
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

    // 🔴 暗号化文書では読まない。pdf-lib 版は復号しなかったので暗号文が出ていた。
    // recover は鍵が導けたときは復号するが、ここは pdf-lib 版と同じ範囲に留める
    // —— 出す・出さないを変えるのは撤去とは別の判断である。
    const fieldName = scope.encrypted ? null : textOf(get(object, 'T'));

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
  }
}
