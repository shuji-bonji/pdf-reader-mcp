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
 */

import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  type PDFPageLeaf,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  pdfDocEncodingDecode,
  utf16Decode,
} from 'pdf-lib';

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

/**
 * The optional language escape sequence at the head of a text string
 * (§7.9.2.2): `ESC`, a language code, `ESC`.
 *
 * §14.9.4 defers to that clause — such a sequence "shall override the prevailing
 * Lang entry" — so it is metadata *about* the replacement text, not part of it,
 * and is stripped rather than emitted as control characters in `read_text`
 * output.
 *
 * It has to come off before PDFDocEncoding decoding: that encoding maps 0x1B to
 * U+02D9 (dot above), not U+001B, so a string-level strip would run after the
 * delimiters had already turned into content.
 */
const MAX_LANGUAGE_CODE_BYTES = 8;
const ESCAPE = 0x1b;

/** Drop a leading `ESC <lang> ESC` from single-byte-encoded bytes. */
function stripLanguageEscapeBytes(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== ESCAPE) return bytes;
  const close = bytes.indexOf(ESCAPE, 1);
  if (close === -1 || close > MAX_LANGUAGE_CODE_BYTES + 1) return bytes;
  return bytes.subarray(close + 1);
}

/** The same, for text already decoded from UTF-16, where ESC survives as U+001B. */
const LANGUAGE_ESCAPE = new RegExp(`^\u001b[^\u001b]{1,${MAX_LANGUAGE_CODE_BYTES}}\u001b`);

function stripLanguageEscape(text: string): string {
  return text.replace(LANGUAGE_ESCAPE, '');
}

/**
 * Decode a PDF *text string* (§7.9.2.2) from its raw bytes.
 *
 * Mirrors pdf-lib's `PDFString.decodeText` (UTF-16BE when the BOM is present,
 * else PDFDocEncoding) and adds the UTF-8 BOM that PDF 2.0 introduced, which
 * pdf-lib 1.x does not handle.
 */
export function decodeTextString(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return stripLanguageEscape(utf16Decode(bytes));
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(stripLanguageEscapeBytes(bytes.subarray(3)));
  }
  return pdfDocEncodingDecode(stripLanguageEscapeBytes(bytes));
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
 */
function scanStream(
  doc: PDFDocument,
  bytes: Uint8Array,
  resources: PDFDict | undefined,
  out: MarkedContentEvent[],
  visiting: Set<string>,
  depth: number,
): void {
  const n = bytes.length;
  let i = 0;
  /** Operands accumulate until an operator consumes them (§7.8.2 postfix form). */
  let operands: Operand[] = [];

  /** `i` is on `/`. Names may carry `#xx` hex escapes (§7.3.5). */
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

  const handleOperator = (op: string): void => {
    switch (op) {
      case 'BMC': {
        const tag = operands.at(-1);
        out.push({ kind: 'begin', tag: tag?.type === 'name' ? tag.value : undefined });
        break;
      }
      case 'BDC': {
        const tag = operands.at(-2);
        const actualText = resolveActualText(doc, operands.at(-1), resources);
        out.push({
          kind: 'begin',
          tag: tag?.type === 'name' ? tag.value : undefined,
          actualText,
        });
        break;
      }
      case 'EMC':
        out.push({ kind: 'end' });
        break;
      case 'Do': {
        const name = operands.at(-1);
        if (name?.type === 'name')
          scanFormXObject(doc, name.value, resources, out, visiting, depth);
        break;
      }
      case 'BI':
        // Inline image (§8.9.7): the bytes between `ID` and `EI` are arbitrary
        // binary and cannot be tokenized, so skip the object wholesale.
        i = skipInlineImage(bytes, i);
        break;
      default:
        break;
    }
    operands = [];
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
        handleOperator(word);
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
 * Resolve the `/ActualText` of a `BDC` property list, which is either an inline
 * dictionary or a name looked up in the resource dictionary's `/Properties`
 * (§14.6.2).
 */
function resolveActualText(
  doc: PDFDocument,
  props: Operand | undefined,
  resources: PDFDict | undefined,
): string | undefined {
  if (props?.type === 'dict') {
    const actual = props.value.get('ActualText');
    return actual?.type === 'string' ? decodeTextString(actual.bytes) : undefined;
  }
  if (props?.type !== 'name' || !resources) return undefined;

  const properties = deref(doc, resources.get(PDFName.of('Properties')));
  if (!(properties instanceof PDFDict)) return undefined;
  const entry = deref(doc, properties.get(PDFName.of(props.value)));
  if (!(entry instanceof PDFDict)) return undefined;

  const actual = deref(doc, entry.get(PDFName.of('ActualText')));
  if (actual instanceof PDFString || actual instanceof PDFHexString) {
    return decodeTextString(actual.asBytes());
  }
  return undefined;
}

/** Follow `Do` into a Form XObject, in place, like pdfjs's `paintXObject`. */
function scanFormXObject(
  doc: PDFDocument,
  name: string,
  resources: PDFDict | undefined,
  out: MarkedContentEvent[],
  visiting: Set<string>,
  depth: number,
): void {
  if (depth >= MAX_XOBJECT_DEPTH || !resources) return;

  const xobjects = deref(doc, resources.get(PDFName.of('XObject')));
  if (!(xobjects instanceof PDFDict)) return;

  const ref = xobjects.get(PDFName.of(name));
  const key = ref instanceof PDFRef ? ref.toString() : `${name}@${depth}`;
  if (visiting.has(key)) return;

  const stream = deref(doc, ref);
  if (!(stream instanceof PDFStream)) return;
  const subtype = deref(doc, stream.dict.get(PDFName.of('Subtype')));
  if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Form') return;

  const contents = decodeStream(stream);
  if (!contents) return;
  const formResources = deref(doc, stream.dict.get(PDFName.of('Resources')));

  visiting.add(key);
  try {
    scanStream(
      doc,
      contents,
      formResources instanceof PDFDict ? formResources : resources,
      out,
      visiting,
      depth + 1,
    );
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

/** Resolve a value that may be an indirect reference. */
function deref(doc: PDFDocument, obj: unknown): unknown {
  return obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
}

/** Decode a stream's bytes, tolerating filters pdf-lib cannot handle. */
function decodeStream(stream: PDFStream): Uint8Array | null {
  try {
    if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
    return stream.getContents();
  } catch {
    return null;
  }
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
 */
export function scanPageMarkedContent(
  doc: PDFDocument,
  pageIndex: number,
): MarkedContentEvent[] | null {
  // An encrypted document's content streams are ciphertext to pdf-lib, which
  // loads with `ignoreEncryption` and so never decrypts them (§7.6.2 encrypts
  // strings and streams). Inflate would fail anyway — "Unknown compression
  // method" — but saying so here keeps the reason from looking like corruption.
  if (doc.isEncrypted) return null;

  let node: PDFPageLeaf;
  try {
    node = doc.getPage(pageIndex).node;
  } catch {
    return null;
  }

  const contents = node.Contents();
  if (!contents) return null;

  const streams: Uint8Array[] = [];
  if (contents instanceof PDFArray) {
    for (const item of contents.asArray()) {
      const resolved = deref(doc, item);
      if (resolved instanceof PDFStream) {
        const decoded = decodeStream(resolved);
        if (decoded) streams.push(decoded);
      }
    }
  } else if (contents instanceof PDFStream) {
    const decoded = decodeStream(contents);
    if (decoded) streams.push(decoded);
  }
  if (streams.length === 0) return null;

  const resources = node.Resources();
  const events: MarkedContentEvent[] = [];
  try {
    // §7.8.2: the parts of a /Contents array form one stream, and the division
    // may occur only between lexical tokens — a single separator restores it.
    scanStream(doc, joinWithNewline(streams), resources ?? undefined, events, new Set(), 0);
  } catch {
    return null;
  }
  return events;
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
