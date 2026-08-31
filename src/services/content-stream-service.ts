/**
 * Content-stream scanner for marked-content property lists (#18).
 *
 * ISO 32000-2 §14.9.4 puts replacement text in exactly two places:
 *
 *  1. a **structure element**'s `/ActualText` (PDF 1.4), reachable from the
 *     structure tree — see `struct-tree-service`;
 *  2. a **marked-content sequence**'s `/ActualText` (PDF 1.5), carried in the
 *     property list of a `Span` tag — which lives only in the content stream.
 *
 * Case 2 occurs in **untagged** documents too, so no amount of structure-tree
 * work reaches it, and pdfjs does not hand it over either: its
 * `getTextContent({ includeMarkedContent: true })` reports where each
 * marked-content sequence begins and ends and keeps `/MCID`, but discards the
 * rest of the property list (pdfjs-dist 4.x, `case OPS.beginMarkedContentProps`
 * in `getTextContent` reads `args[1].get("MCID")` and nothing else).
 *
 * So the property lists have to be read from the content stream directly. This
 * scanner does **not** decode glyphs — it only records the *order* of
 * `BMC` / `BDC` / `EMC` operators. That order is 1:1 with the markers pdfjs
 * emits, so the two streams are aligned by index rather than by coordinate,
 * which is what makes the approach cheap to verify: if the counts differ, the
 * alignment is known to be wrong and the caller falls back instead of
 * corrupting the text.
 *
 * Two ordering rules are mirrored from pdfjs so the indices line up:
 *
 *  - a page's `/Contents` array is one stream, concatenated with white space
 *    between the parts (§7.8.2: the division may occur only between lexical
 *    tokens);
 *  - `Do` on a **Form** XObject is walked inline at that point, using the
 *    form's own `/Resources` and falling back to the parent's — exactly what
 *    pdfjs's `case OPS.paintXObject` does.
 *
 * ## COS の読み口（S3・2026-08-31）
 *
 * pdf-lib の `PDFDict` / `PDFRef` / `PDFStream` を `@normativepdf/recover` の
 * `asDict` / `asRef` / `asStream` に替えた。違いは 2 つある。
 *
 * 1. **参照の解決とストリームの復号が非同期になった。** `doc.context.lookup()` は
 *    同期だったが `resolved(doc, …)` は Promise を返す。演算子ごとに `await` を
 *    置くと、内容ストリームのトークン 1 つごとにマイクロタスクが 1 つ入る
 *    （本文 1 ページで数万件）。そこで**走査の本体は同期のまま**にし、
 *    `handleOperator` は解決が要るときだけ Promise を返す
 *    （`BDC` の名前が初出のとき・`Do`・`Tf` のフォントが初出のとき）。
 *    それ以外の演算子は 1 つも `await` を通らない。
 * 2. **暗号化された文書が読めるようになった。** pdf-lib は `ignoreEncryption` で
 *    開いていたので内容ストリームは暗号文のままで、`doc.isEncrypted` が真なら
 *    走査を諦めていた。recover は鍵が導ければ復号するので、諦めるのは
 *    **鍵が導けなかったとき**だけになった（`lockedOut(scope)`）。
 */

import {
  asArray,
  asDict,
  asRef,
  asStream,
  decodedBytes,
  get,
  nameOf,
  refKey,
  resolved,
  textOf,
} from '@normativepdf/recover';
import {
  type CosDict,
  decodeTextString,
  inheritedAttribute,
  type PageTree,
  type PdfDocument,
  readPageTree,
} from 'normativepdf';

/**
 * テキスト文字列（§7.9.2.2）の復号。**コアの 1 本を使う。**
 *
 * pdf-lib 版はここに自前の実装を持っており、`PDFDocEncoding` のバイト列からも
 * 先頭の `ESC <lang> ESC` を落としていた。§7.9.2.2.2 は
 * 「Escape sequences may appear anywhere in a **Unicode** text string」と書き、
 * 要素 a) で「for strings encoded in UTF-16BE … for strings encoded in UTF-8」と
 * 名指ししている。PDFDocEncoding は名指しされていない —— そして Table D.3 では
 * バイト 0x1B は U+02D9（DOT ABOVE）なので、落としていたのは本文の文字だった。
 * 再輸出しているのは、コアの版が上がってこの復号が変わったときに
 * reader の試験が気づくようにするためである。
 */
export { decodeTextString };

/**
 * One `BMC` / `BDC` / `EMC` operator, in content-stream order.
 *
 * `EMC` carries no data; it is recorded so that nesting can be reconstructed by
 * the consumer without re-parsing.
 */
export interface MarkedContentEvent {
  kind: 'begin' | 'end';
  /** The tag operand of `BMC` / `BDC` (e.g. `Span`, `P`, `Artifact`). */
  tag?: string;
  /** `/ActualText` from the property list, already decoded to a JS string. */
  actualText?: string;
}

/**
 * What a text-showing operator referenced, collected alongside the
 * marked-content walk (#21).
 *
 * ISO 32000-2 §9.10.1 makes the question "can this page's characters be
 * converted to Unicode?" answerable from the file: it depends on the operators
 * that show text and on the fonts those operators had selected. Both live in the
 * content stream, so they are gathered by the same scan rather than by a second
 * one that could disagree with it.
 *
 * `usedFonts` is keyed by the `Tf` resource name and holds the font dictionary
 * that name resolved to in the resource dictionary then in effect — `null` when
 * the name resolves to nothing, which is itself an observation (the text was
 * shown with a font the file does not describe).
 */
export interface TextOperatorTally {
  /** `Tj` / `TJ` / `'` / `"` occurrences. */
  textShowingOperators: number;
  /** `Do` on an Image XObject, plus `BI` inline images. */
  imageOperators: number;
  usedFonts: Map<string, CosDict | null>;
}

/** Mutable scan state for {@link TextOperatorTally}; `currentFont` is the `Tf` in effect. */
interface TextSink extends TextOperatorTally {
  currentFont: string | null;
}

/**
 * 走査中に引く資源辞書（§7.8.3）を、**解決した形で 1 度だけ持つ**。
 *
 * `/Font` `/Properties` `/XObject` の 3 つは辞書そのものをここで解いておき、
 * その中の 1 件を引くのは初出のときだけ行う。演算子ごとに `resolved()` を
 * 呼ぶと、本文 1 ページ分のトークンすべてに Promise が 1 つ付く。
 */
interface ScanResources {
  /** 資源辞書そのもの。入れ子のフォームが `/Resources` を持たないときはこれを引き継ぐ */
  readonly dict: CosDict | null;
  readonly fonts: CosDict | null;
  readonly properties: CosDict | null;
  readonly xobjects: CosDict | null;
  /** 名前つき property list の `/ActualText`。値が無いことも憶える（`undefined` を入れる） */
  readonly actualTextByName: Map<string, string | undefined>;
}

async function prepareResources(doc: PdfDocument, dict: CosDict | null): Promise<ScanResources> {
  return {
    dict,
    fonts: asDict(await resolved(doc, get(dict, 'Font'))),
    properties: asDict(await resolved(doc, get(dict, 'Properties'))),
    xobjects: asDict(await resolved(doc, get(dict, 'XObject'))),
    actualTextByName: new Map(),
  };
}

/**
 * How deep `Do` on a Form XObject is followed.
 *
 * A form may legitimately draw another form; a *cycle* is malformed but does
 * occur in the wild and would otherwise recurse forever. The `visiting` set
 * already blocks cycles — this bounds the pathological deep-nesting case too.
 */
const MAX_XOBJECT_DEPTH = 16;

/** Bytes that PDF treats as white space (§7.2.3 Table 1). */
const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);

/** Bytes that delimit a token (§7.2.3 Table 2). */
const DELIMITER = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isWhitespace(b: number): boolean {
  return WHITESPACE.has(b);
}

function isRegular(b: number): boolean {
  return !WHITESPACE.has(b) && !DELIMITER.has(b);
}

/** A parsed operand. Only the shapes the scanner acts on are distinguished. */
type Operand =
  | { type: 'name'; value: string }
  | { type: 'dict'; value: Map<string, Operand> }
  | { type: 'string'; bytes: Uint8Array }
  | { type: 'other' };

/**
 * Scan one content stream, appending events to `out`.
 *
 * `resources` is the resource dictionary in effect, needed to resolve a `BDC`
 * whose property list is named rather than inline (`/Span /P1 BDC` →
 * `/Properties /P1`, §14.6.2) and to follow `Do` into Form XObjects.
 *
 * 🔴 **走査の本体は同期である。** `handleOperator` は解決が要るときだけ
 * Promise を返し、返したときだけ呼び出し側が `await` する。演算子ごとに
 * `await` を置くと、トークン 1 つごとにマイクロタスクが 1 つ入る。
 */
async function scanStream(
  doc: PdfDocument,
  bytes: Uint8Array,
  resources: ScanResources,
  out: MarkedContentEvent[],
  visiting: Set<string>,
  depth: number,
  text?: TextSink,
): Promise<void> {
  const n = bytes.length;
  let i = 0;
  /** Operands accumulate until an operator consumes them (§7.8.2 postfix form). */
  let operands: Operand[] = [];
  const readName = (): string => {
    i++;
    const chars: number[] = [];
    while (i < n && isRegular(bytes[i])) {
      if (bytes[i] === 0x23 && i + 2 < n) {
        const code = Number.parseInt(String.fromCharCode(bytes[i + 1], bytes[i + 2]), 16);
        if (!Number.isNaN(code)) {
          chars.push(code);
          i += 3;
          continue;
        }
      }
      chars.push(bytes[i]);
      i++;
    }
    return String.fromCharCode(...chars);
  };

  /** `i` is on `(`. Resolves the escapes of §7.3.4.2 Table 3. */
  const readLiteralString = (): Uint8Array => {
    i++;
    let nesting = 1;
    const result: number[] = [];
    while (i < n) {
      const b = bytes[i];
      if (b === 0x5c) {
        const e = bytes[i + 1];
        i += 2;
        if (e === 0x6e) result.push(0x0a);
        else if (e === 0x72) result.push(0x0d);
        else if (e === 0x74) result.push(0x09);
        else if (e === 0x62) result.push(0x08);
        else if (e === 0x66) result.push(0x0c);
        else if (e === 0x0a) {
          /* line continuation */
        } else if (e === 0x0d) {
          if (bytes[i] === 0x0a) i++;
        } else if (e >= 0x30 && e <= 0x37) {
          let octal = e - 0x30;
          for (let k = 0; k < 2 && i < n && bytes[i] >= 0x30 && bytes[i] <= 0x37; k++) {
            octal = octal * 8 + (bytes[i] - 0x30);
            i++;
          }
          result.push(octal & 0xff);
        } else {
          result.push(e);
        }
        continue;
      }
      if (b === 0x28) nesting++;
      if (b === 0x29) {
        nesting--;
        if (nesting === 0) {
          i++;
          break;
        }
      }
      result.push(b);
      i++;
    }
    return new Uint8Array(result);
  };

  /** `i` is on a `<` that does not begin `<<`. */
  const readHexString = (): Uint8Array => {
    i++;
    const digits: number[] = [];
    while (i < n && bytes[i] !== 0x3e) {
      const c = bytes[i];
      const d =
        c >= 0x30 && c <= 0x39
          ? c - 0x30
          : c >= 0x41 && c <= 0x46
            ? c - 0x37
            : c >= 0x61 && c <= 0x66
              ? c - 0x57
              : -1;
      if (d >= 0) digits.push(d);
      i++;
    }
    i++; // past `>`
    if (digits.length % 2 === 1) digits.push(0); // §7.3.4.3: an odd final digit is padded
    const result = new Uint8Array(digits.length / 2);
    for (let k = 0; k < result.length; k++) result[k] = digits[k * 2] * 16 + digits[k * 2 + 1];
    return result;
  };

  /** `i` is on the first `<` of `<<`. */
  const readDict = (): Map<string, Operand> => {
    i += 2;
    const map = new Map<string, Operand>();
    let key: string | null = null;
    while (i < n) {
      if (isWhitespace(bytes[i])) {
        i++;
        continue;
      }
      if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) {
        i += 2;
        break;
      }
      const before = i;
      const value = readValue();
      if (i === before) i++; // never stall on junk
      if (value === null) continue;
      if (key === null) key = value.type === 'name' ? value.value : '';
      else {
        map.set(key, value);
        key = null;
      }
    }
    return map;
  };

  /**
   * Parse one *value* at `i`, advancing past it.
   *
   * Deliberately distinct from the top-level loop: a bare keyword nested inside
   * a dictionary or array (`true`, `null`) is data, not an operator, and must
   * not be routed to `handleOperator` — which clears the operand stack and
   * would drop the `/Span` tag of the very `BDC` being parsed.
   */
  const readValue = (): Operand | null => {
    const b = bytes[i];
    if (b === 0x2f) return { type: 'name', value: readName() };
    if (b === 0x28) return { type: 'string', bytes: readLiteralString() };
    if (b === 0x3c && bytes[i + 1] === 0x3c) return { type: 'dict', value: readDict() };
    if (b === 0x3c) return { type: 'string', bytes: readHexString() };
    if (b === 0x5b) {
      i++;
      let guard = 0;
      while (i < n && bytes[i] !== 0x5d && guard++ < 100_000) {
        if (isWhitespace(bytes[i])) {
          i++;
          continue;
        }
        const before = i;
        readValue();
        if (i === before) i++;
      }
      i++;
      return { type: 'other' };
    }
    if (b === 0x25) {
      while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      return null;
    }
    if (b === 0x5d || b === 0x7b || b === 0x7d || b === 0x29 || b === 0x3e) {
      i++;
      return null;
    }
    const word = readKeyword();
    return word === null ? null : { type: 'other' };
  };

  /** Read a run of regular characters (a number, keyword or operator). */
  const readKeyword = (): string | null => {
    let j = i;
    while (j < n && isRegular(bytes[j])) j++;
    if (j === i) return null;
    const word = String.fromCharCode(...bytes.subarray(i, j));
    i = j;
    return word;
  };

  /**
   * 1 つの演算子を処理する。**解決が要るときだけ Promise を返す。**
   *
   * 返すのは 3 つの場合だけである: `BDC` の property list が名前で、その名前が
   * この資源辞書で初めて出たとき / `Do` / `Tj` 系でそのとき選ばれているフォントが
   * まだ `usedFonts` に無いとき。それ以外の演算子は 1 つも `await` を通らない。
   */
  const handleOperator = (op: string): Promise<void> | undefined => {
    // §7.8.2 の後置形。演算子を読んだ時点でオペランドは使い切る。
    const ops = operands;
    operands = [];
    switch (op) {
      case 'BMC': {
        const tag = ops.at(-1);
        out.push({ kind: 'begin', tag: tag?.type === 'name' ? tag.value : undefined });
        return undefined;
      }
      case 'BDC': {
        const tag = ops.at(-2);
        const tagName = tag?.type === 'name' ? tag.value : undefined;
        const props = ops.at(-1);
        // インラインの property list（§14.6.2）。参照は無いので解決は要らない。
        if (props?.type === 'dict') {
          const actual = props.value.get('ActualText');
          out.push({
            kind: 'begin',
            tag: tagName,
            actualText: actual?.type === 'string' ? decodeTextString(actual.bytes) : undefined,
          });
          return undefined;
        }
        if (props?.type !== 'name') {
          out.push({ kind: 'begin', tag: tagName, actualText: undefined });
          return undefined;
        }
        const name = props.value;
        if (resources.actualTextByName.has(name)) {
          out.push({
            kind: 'begin',
            tag: tagName,
            actualText: resources.actualTextByName.get(name),
          });
          return undefined;
        }
        return namedActualText(doc, resources, name).then((actualText) => {
          out.push({ kind: 'begin', tag: tagName, actualText });
        });
      }
      case 'EMC':
        out.push({ kind: 'end' });
        return undefined;
      case 'Do': {
        const name = ops.at(-1);
        if (name?.type !== 'name') return undefined;
        return scanFormXObject(doc, name.value, resources, out, visiting, depth, text);
      }
      case 'BI':
        // Inline image (§8.9.7): the bytes between `ID` and `EI` are arbitrary
        // binary and cannot be tokenized, so skip the object wholesale.
        if (text) text.imageOperators++;
        i = skipInlineImage(bytes, i);
        return undefined;
      case 'Tf': {
        // `Tf` takes the font's *resource* name and a size (§9.3.1). The name is
        // recorded rather than the dictionary: the same name means a different
        // font inside a Form XObject with its own /Resources, so it is resolved
        // at the point of use, below.
        // Recorded, not counted: a `Tf` with no text-showing operator after it
        // selects a font that never converts anything, and counting it would
        // report loss on a page that shows nothing. The font is registered at
        // the point text is actually shown, below.
        if (text) {
          const name = ops.at(-2);
          text.currentFont = name?.type === 'name' ? name.value : null;
        }
        return undefined;
      }
      case 'Tj':
      case 'TJ':
      case "'":
      case '"': {
        // The four text-showing operators of §9.4.3 Table 107.
        if (!text) return undefined;
        text.textShowingOperators++;
        const font = text.currentFont;
        if (!font || text.usedFonts.has(font)) return undefined;
        return noteFontUse(doc, text, font, resources);
      }
      default:
        return undefined;
    }
  };

  while (i < n) {
    const b = bytes[i];
    if (isWhitespace(b)) {
      i++;
      continue;
    }
    const before = i;
    if (isRegular(b) && !(b >= 0x30 && b <= 0x39) && b !== 0x2b && b !== 0x2d && b !== 0x2e) {
      // A keyword at operand position is an operator.
      const word = readKeyword();
      if (word !== null) {
        const pending = handleOperator(word);
        if (pending) await pending;
        continue;
      }
    }
    const operand = readValue();
    if (operand !== null) operands.push(operand);
    if (i === before) i++; // never stall
    // Bound pathological input: no operator takes more than a handful of
    // operands, and `BDC` only ever looks at the last two.
    if (operands.length > 64) operands = operands.slice(-8);
  }
}

/**
 * Resolve the `/ActualText` of a `BDC` property list named in the resource
 * dictionary's `/Properties` (§14.6.2).
 *
 * 引けなかったことも `actualTextByName` に憶える。同じ名前が 1 ページで
 * 何百回も出る文書があり、そのたびに引き直すと解決の回数がその回数になる。
 */
async function namedActualText(
  doc: PdfDocument,
  resources: ScanResources,
  name: string,
): Promise<string | undefined> {
  const entry = asDict(await resolved(doc, get(resources.properties, name)));
  const actual = entry ? textOf(await resolved(doc, get(entry, 'ActualText'))) : null;
  const value = actual ?? undefined;
  resources.actualTextByName.set(name, value);
  return value;
}

/**
 * Record the font a `Tf` selected, resolved through the resource dictionary in
 * effect (§7.8.3 `/Font`).
 *
 * A name that resolves to nothing is stored as `null` rather than dropped: text
 * shown with a font the file does not describe is a real observation, and
 * silently omitting it would make the page look fully mappable.
 */
async function noteFontUse(
  doc: PdfDocument,
  text: TextSink,
  name: string,
  resources: ScanResources,
): Promise<void> {
  if (text.usedFonts.has(name)) return;
  text.usedFonts.set(name, asDict(await resolved(doc, get(resources.fonts, name))));
}

/** Follow `Do` into a Form XObject, in place, like pdfjs's `paintXObject`. */
async function scanFormXObject(
  doc: PdfDocument,
  name: string,
  resources: ScanResources,
  out: MarkedContentEvent[],
  visiting: Set<string>,
  depth: number,
  text?: TextSink,
): Promise<void> {
  if (depth >= MAX_XOBJECT_DEPTH || !resources.dict || !resources.xobjects) return;

  const entry = get(resources.xobjects, name);
  const ref = asRef(entry);
  const key = ref ? refKey(ref) : `${name}@${depth}`;
  if (visiting.has(key)) return;

  const stream = asStream(await resolved(doc, entry));
  if (!stream) return;
  const subtype = nameOf(await resolved(doc, get(stream.dict, 'Subtype')));
  if (subtype === null) return;
  if (subtype === 'Image') {
    if (text) text.imageOperators++;
    return;
  }
  if (subtype !== 'Form') return;

  const { bytes } = await decodedBytes(doc, stream);
  if (!bytes) return;

  const own = asDict(await resolved(doc, get(stream.dict, 'Resources')));
  const inner = own ? await prepareResources(doc, own) : resources;

  visiting.add(key);
  try {
    await scanStream(doc, bytes, inner, out, visiting, depth + 1, text);
  } finally {
    visiting.delete(key);
  }
}

/**
 * Skip an inline image, from just past `BI` to just past the closing `EI`.
 *
 * The data after `ID` is arbitrary binary, so `EI` is found by scanning for the
 * keyword delimited by white space — the same heuristic every PDF consumer uses,
 * because the format offers nothing better without decoding the image.
 */
function skipInlineImage(bytes: Uint8Array, from: number): number {
  const n = bytes.length;
  let i = from;
  while (i < n - 1) {
    if (bytes[i] === 0x49 && bytes[i + 1] === 0x44 && (i === 0 || !isRegular(bytes[i - 1]))) {
      i += 2;
      break;
    }
    i++;
  }
  i++; // the single white-space byte that follows `ID`
  while (i < n - 1) {
    if (
      bytes[i] === 0x45 &&
      bytes[i + 1] === 0x49 &&
      isWhitespace(bytes[i - 1]) &&
      (i + 2 >= n || !isRegular(bytes[i + 2]))
    ) {
      return i + 2;
    }
    i++;
  }
  return n;
}

/**
 * ページ木は 1 文書につき 1 回だけ歩く。
 *
 * pdf-lib の `doc.getPage(i)` は文書が持っている配列を引くだけだったが、
 * `readPageTree` は §7.7.3 の木を毎回歩き直す。`read_text` は
 * ページごとにこの入口を呼ぶので、200 ページの文書では歩きが 200 回になる。
 * 出力は変わらない —— 変わるのは歩く回数だけである。
 */
const pageTrees = new WeakMap<PdfDocument, Promise<PageTree | null>>();

function pageTreeOf(doc: PdfDocument): Promise<PageTree | null> {
  const cached = pageTrees.get(doc);
  if (cached) return cached;
  const walking = readPageTree(doc).catch(() => null);
  pageTrees.set(doc, walking);
  return walking;
}

/**
 * この文書のページ数。**木に届かなかったときは `null`** を返す。
 *
 * 🔴 `0` を返さない。`0` は「ページが 1 つも無い木を読んだ」という観測結果であり、
 * 「木を読めなかった」ではない。同じ数で両方を言うと、後者が前者の顔をする
 * （このファイルの `scanPage` が `null` と空の観測を分けているのと同じ理由）。
 */
export async function pageCountOf(doc: PdfDocument): Promise<number | null> {
  const tree = await pageTreeOf(doc);
  if (!tree?.reached) return null;
  return tree.pages.length;
}

/**
 * Scan one page's content for marked-content operators, in stream order.
 *
 * Returns `null` when the page's content cannot be read (missing or undecodable
 * stream). Callers must treat `null` — and any count that disagrees with pdfjs's
 * marker count — as "alignment unknown" and skip replacement: a scanner that is
 * off by one sequence would move replacement text onto the wrong glyphs. Failing
 * to resolve `/ActualText` leaves the pre-existing behaviour (raw glyphs, plus
 * the #15 note); mis-resolving it would be a new and worse failure.
 *
 * @param pageIndex 0-based page index.
 * @param lockedOut 暗号化されていて鍵が導けなかった（`lockedOut(scope)`）。
 */
export async function scanPageMarkedContent(
  doc: PdfDocument,
  pageIndex: number,
  lockedOut: boolean,
): Promise<MarkedContentEvent[] | null> {
  return (await scanPage(doc, pageIndex, lockedOut))?.events ?? null;
}

/**
 * The same scan, with the text-showing tally #21 needs kept as well.
 *
 * Returns `null` for the same reasons `scanPageMarkedContent` does — a document
 * whose key could not be derived, a missing or undecodable content stream. A
 * `null` here is "not observed", never "no text": the difference is the whole
 * point of #21.
 */
export async function scanPageTextOperators(
  doc: PdfDocument,
  pageIndex: number,
  lockedOut: boolean,
): Promise<{ tally: TextOperatorTally; actualTextEntries: number } | null> {
  const scanned = await scanPage(doc, pageIndex, lockedOut);
  if (!scanned) return null;
  return {
    tally: scanned.text,
    actualTextEntries: scanned.events.filter((e) => e.actualText !== undefined).length,
  };
}

function emptySink(): TextSink {
  return { textShowingOperators: 0, imageOperators: 0, usedFonts: new Map(), currentFont: null };
}

async function scanPage(
  doc: PdfDocument,
  pageIndex: number,
  lockedOut: boolean,
): Promise<{ events: MarkedContentEvent[]; text: TextSink } | null> {
  // 鍵が導けなかった暗号化文書では、間接オブジェクトを 1 つも読めない
  // （ADR-0008 —— normativepdf は暗号文を平文の顔で返さない）。内容ストリームも
  // 同じで、読めないことを申告するのは呼び出し側の仕事である。
  // 🔴 pdf-lib 版はここが `doc.isEncrypted` だった。pdf-lib は `ignoreEncryption`
  // で開いていて復号しないので、**鍵が導ける文書まで諦めていた**。
  if (lockedOut) return null;

  const page = (await pageTreeOf(doc))?.pages[pageIndex];
  if (!page) return null;

  const contentsEntry = get(page.dict, 'Contents');
  if (contentsEntry === undefined) {
    // §7.7.3.3 makes /Contents optional, and its absence has a definite
    // meaning: the page is empty. That is an observation, not a failure to
    // observe — returning `null` here would report a blank page as "could not
    // be read", which is the confusion #21 is about.
    return { events: [], text: emptySink() };
  }

  const contents = await resolved(doc, contentsEntry);
  const streams: Uint8Array[] = [];
  const parts = asArray(contents);
  if (parts) {
    for (const item of parts.items) {
      const stream = asStream(await resolved(doc, item));
      if (!stream) continue;
      const { bytes } = await decodedBytes(doc, stream);
      if (bytes) streams.push(bytes);
    }
  } else {
    const stream = asStream(contents);
    if (stream) {
      const { bytes } = await decodedBytes(doc, stream);
      if (bytes) streams.push(bytes);
    }
  }
  if (streams.length === 0) return null;

  // `/Resources` は継承する（Table 31・§7.7.3.4）。pdf-lib の
  // `PDFPageLeaf.Resources()` も親を辿っていたので、そこは同じ読み方である。
  const resources = await prepareResources(
    doc,
    asDict(await resolved(doc, inheritedAttribute(page, 'Resources'))),
  );

  const events: MarkedContentEvent[] = [];
  const text = emptySink();
  try {
    // §7.8.2: the parts of a /Contents array form one stream, and the division
    // may occur only between lexical tokens — a single separator restores it.
    await scanStream(doc, joinWithNewline(streams), resources, events, new Set(), 0, text);
  } catch {
    return null;
  }
  return { events, text };
}

function joinWithNewline(streams: Uint8Array[]): Uint8Array {
  const total = streams.reduce((sum, s) => sum + s.length + 1, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const s of streams) {
    joined.set(s, offset);
    offset += s.length;
    joined[offset] = 0x0a;
    offset += 1;
  }
  return joined;
}
