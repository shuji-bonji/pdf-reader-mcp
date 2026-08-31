/**
 * 文書の骨格を読む（`inspect_structure`）。
 *
 * 目録・ページ木・間接オブジェクトの数え上げ・版を返す。判定は書かない ——
 * ここが答えるのは「この文書には何が何個あるか」だけである。
 *
 * ## 型名の語彙（S4・2026-08-31）
 *
 * pdf-lib 版はここで `obj.constructor.name` をそのまま出していたので、出力の
 * 語彙が `PDFCatalog` / `PDFPageTree` / `PDFPageLeaf` / `PDFRawStream` という
 * **pdf-lib の内部クラス名**になっていた。撤去するとその語彙は作れない。
 *
 * COS の型（§7.3）に替えた。`byType` は `kind` —— `dict` / `stream` / `array` /
 * `name` / `string` / `integer` / `real` / `boolean` / `null` / `ref` の 10 種で、
 * `@normativepdf/recover` が返す綴りそのままである。family の中で同じものを
 * 2 つの名前で呼ばないための選び方で、条文の分類でもある。
 *
 * pdf-lib の `PDFCatalog` / `PDFPageTree` / `PDFPageLeaf` が運んでいたのは
 * 辞書の `/Type` そのものなので、それは `byDocType` に分けて出す。
 * §7.3 の型と `/Type` は別の問いで、1 つの数に畳むと
 * 「dict が 51,237 個」と「Page が 13,001 個」が同じ欄を取り合う。
 *
 * 🔴 pdf-lib は `PDFNumber` 1 つで整数と実数を畳んでいた。R-7.3.3-6 は
 * 「A real number shall not be present when an integer is expected」と書いて
 * 区別を要求しているので、`integer` と `real` は分けて数える。
 */

import { open } from 'node:fs/promises';
import {
  asDict,
  asStream,
  enumerateObjects,
  get,
  nameOf,
  numbersOf,
  resolved,
} from '@normativepdf/recover';
import { type CosObject, decodeTextString, inheritedAttribute, readPageTree } from 'normativepdf';
import type { CatalogEntry, ObjectStats, PageTreeInfo, StructureAnalysis } from '../types.js';
import { lockedOut, openPdf } from './recover-service.js';

/**
 * 鍵が導けなかったときに出す 1 文。
 *
 * ADR-0008: normativepdf は鍵が導けないと間接オブジェクトを 1 つも渡さない。
 * このとき数はすべて 0 になるが、0 は「無い」ではなく「読めなかった」である。
 * pdf-lib は `ignoreEncryption` で構造だけ歩けたので、この文は要らなかった。
 */
const LOCKED_OUT_NOTE =
  'The document is encrypted and the key could not be derived from the empty user password ' +
  '(ISO 32000-2 §7.6.4.3.2), so not one indirect object could be read. The counts below are ' +
  'what could be seen without the key, not what the file contains.';

/** 目録から取る `mediaBoxSamples` の上限。先頭から数ページ見れば形は分かる。 */
const MAX_MEDIA_BOX_SAMPLES = 5;

/**
 * Analyze PDF internal structure (catalog, page tree, objects).
 *
 * ページ木に届かなかったときは `note` でそう言い、ページ数だけ pdfjs から取る。
 * pdf-lib 版が Linearized PDF のために持っていた退路で、recover でも
 * 「目録から `/Pages` に届かない」文書は同じ形になる。
 */
export async function analyzeStructure(filePath: string): Promise<StructureAnalysis> {
  const { doc, scope } = await openPdf(filePath);
  const locked = lockedOut(scope);
  const catalog = asDict(await doc.getCatalog().catch(() => null));

  const catalogEntries: CatalogEntry[] = [];
  for (const [key, value] of catalog?.entries ?? []) {
    catalogEntries.push({ key, type: value.kind, value: summarizeObject(value) });
  }

  const tree = await readPageTree(doc).catch(() => null);
  const pages = tree?.reached ? tree.pages : [];
  let totalPages = pages.length;

  const mediaBoxSamples: PageTreeInfo['mediaBoxSamples'] = [];
  for (const page of pages.slice(0, MAX_MEDIA_BOX_SAMPLES)) {
    // pdf-lib の `getMediaBox()` は継承込みで引き（Table 31）、4 要素の数でなければ
    // 投げていた（呼び出し側が握って次のページへ進む）。同じ形にしてある。
    const box = await numbersOf(doc, inheritedAttribute(page, 'MediaBox'));
    if (box?.length !== 4) continue;
    mediaBoxSamples.push({
      page: page.index + 1,
      // 🔴 正規化しない。pdf-lib の `asRectangle` は `width = urx - llx` を返すので、
      // 逆順の矩形は負の幅のまま出ていた。そこは変えていない。
      width: Math.round((box[2] - box[0]) * 100) / 100,
      height: Math.round((box[3] - box[1]) * 100) / 100,
    });
  }

  let note: string | undefined;
  if (locked) {
    // 🔴 数はどれも 0 になるが、それは「無い」ではなく「読めなかった」である。
    // `unreadable` が表に載っている数を持つので、0 と N が対で出る。
    note = LOCKED_OUT_NOTE;
  } else if (totalPages === 0) {
    // ページ木に届かなかった。ページ数だけでも別の読み手から取る。
    try {
      const { loadDocument } = await import('./pdfjs-service.js');
      const pdfjsDoc = await loadDocument(filePath);
      try {
        totalPages = pdfjsDoc.numPages;
        note =
          'The page tree could not be walked from the catalogue (ISO 32000-2 §7.7.3); ' +
          'totalPages was obtained via pdfjs-dist. mediaBox samples are unavailable.';
      } finally {
        await pdfjsDoc.destroy();
      }
    } catch {
      note = 'The page tree could not be resolved by either reader.';
    }
  }

  const objectStats = await countObjects(doc);

  // PDF version: the LATER of the file header and the catalog's /Version.
  // Table 29 does not let the catalog simply win — see resolvePdfVersion.
  // The catalog entry "shall be a name object, not a number", hence nameOf.
  const headerVersion = await readHeaderVersion(filePath);
  const catalogVersion = nameOf(await resolved(doc, get(catalog, 'Version')));

  const result: StructureAnalysis = {
    catalog: catalogEntries,
    pageTree: { totalPages, mediaBoxSamples },
    objectStats,
    isEncrypted: scope.encrypted,
    pdfVersion: resolvePdfVersion(headerVersion, catalogVersion),
  };
  if (note) result.note = note;
  return result;
}

/**
 * 間接オブジェクトを数える。
 *
 * 🔴 **`unreadable` を別に持つ。** 読めなかったオブジェクトを黙って落とすと、
 * `totalObjects` が「表に載っている数」でも「読めた数」でもない 3 つ目の数になる。
 * pdf-lib 版はここを落としていた（`PDFInvalidObject` という名前で 10 件だけ数えて
 * いたが、それは pdf-lib が値を作れた分である）。
 *
 * 🔴 **`/ObjStm` と `/XRef` 自身が数に入る。** pdf-lib の
 * `enumerateIndirectObjects()` はこの 2 つを返さなかった（S1 で
 * `locate_objects` について実測し、`qpdf --show-object` で 379/379 裏を取った）。
 * `totalObjects` はその分だけ増える。
 */
async function countObjects(doc: Parameters<typeof enumerateObjects>[0]): Promise<ObjectStats> {
  const { objects, unreadable } = await enumerateObjects(doc);
  const byType: Record<string, number> = {};
  const byDocType: Record<string, number> = {};
  let streamCount = 0;

  for (const { object } of objects) {
    byType[object.kind] = (byType[object.kind] ?? 0) + 1;
    if (object.kind === 'stream') streamCount++;
    // `/Type` は辞書のエントリなので、ストリームの辞書からも読む。
    const dict = asDict(object) ?? asStream(object)?.dict ?? null;
    const docType = nameOf(get(dict, 'Type'));
    if (docType !== null) byDocType[docType] = (byDocType[docType] ?? 0) + 1;
  }

  return { totalObjects: objects.length, streamCount, byType, byDocType, unreadable };
}

// ─── Internal helpers ────────────────────────────────────

/** A PDF version as written in a header or catalog: `major.minor`. */
const PDF_VERSION_PATTERN = /^(\d+)\.(\d+)$/;

/**
 * Read the version from the file header (`%PDF-x.y`, ISO 32000-2 §7.5.2).
 *
 * Only the first 20 bytes are read — the header is at the very start, and the
 * file may be large.
 */
async function readHeaderVersion(filePath: string): Promise<string | null> {
  try {
    const fh = await open(filePath, 'r');
    try {
      const buf = Buffer.alloc(20);
      await fh.read(buf, 0, 20, 0);
      return buf.toString('ascii').match(/%PDF-(\d+\.\d+)/)?.[1] ?? null;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/** Compare `major.minor` versions. Returns > 0 if `a` is later than `b`. */
function compareVersions(a: string, b: string): number {
  const ma = a.match(PDF_VERSION_PATTERN);
  const mb = b.match(PDF_VERSION_PATTERN);
  if (!ma || !mb) return 0;
  return Number(ma[1]) - Number(mb[1]) || Number(ma[2]) - Number(mb[2]);
}

/**
 * Resolve the PDF version the document conforms to.
 *
 * ISO 32000-2 Table 29 (Version) makes the catalog entry conditional, not
 * authoritative: it is the version "to which the document conforms … **if later
 * than the version specified in the file's header**. If the header specifies a
 * later version, or if this entry is absent, the document shall conform to the
 * version specified in the header."
 *
 * So the answer is the later of the two. The previous code returned the catalog
 * entry unconditionally whenever it existed, which reports the wrong version for
 * a file whose header is newer — the exact case Table 29 calls out. (The entry
 * exists so a version can be *raised* by an incremental update; see §7.5.6.)
 *
 * A malformed catalog entry cannot be shown to specify a later version, so the
 * header wins by default.
 *
 * Exported for unit testing — the interesting cases (header newer, versions
 * equal, catalog malformed) would each need a hand-built PDF otherwise.
 */
export function resolvePdfVersion(
  headerVersion: string | null,
  catalogVersion: string | null,
): string | null {
  if (!catalogVersion) return headerVersion;
  if (!headerVersion) return PDF_VERSION_PATTERN.test(catalogVersion) ? catalogVersion : null;
  return compareVersions(catalogVersion, headerVersion) > 0 ? catalogVersion : headerVersion;
}

/**
 * Summarize a PDF object for display (truncated).
 *
 * 参照は**解決しない** —— 目録の一覧が答えるのは「この鍵に何が書いてあるか」で
 * あって、その先に何があるかではない。pdf-lib 版と同じ形の文字列を返す。
 */
function summarizeObject(obj: CosObject): string {
  switch (obj.kind) {
    case 'ref':
      return `ref(${obj.objectNumber})`;
    case 'name':
      return obj.value;
    case 'array':
      return `Array[${obj.items.length}]`;
    case 'dict':
      return `Dict{${obj.entries.size} entries}`;
    case 'stream':
      return `Stream{${obj.raw.length} bytes}`;
    case 'integer':
    case 'real':
      return String(obj.value);
    case 'boolean':
      return String(obj.value);
    case 'string':
      return decodeTextString(obj.bytes);
    case 'null':
      return 'null';
  }
}
