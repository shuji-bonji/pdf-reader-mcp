/**
 * 文書レベルの XMP メタデータストリーム（ISO 32000-2 §14.3.2）を読む。
 *
 * `get_metadata` が返しているのは Info 辞書（§14.3.3）で、XMP ではない。PDF/A・PDF/UA の
 * 適合宣言（`pdfaid:*` / `pdfuaid:part`）と、著者の TDM（text and data mining）に対する
 * 権利表明（W3C TDMRep）は XMP にしか書かれないので、ここで別に読む（#27 / #28 / #29）。
 *
 * 🔴 ここで返すのは**書いてある値**である。`pdfuaid:part = 1` は「PDF/UA-1 を宣言している」
 * であって「PDF/UA-1 に適合している」ではない。適合の判定は pdf-verify-mcp の
 * `validate_conformance` が行う。同じく `tdm:reservation = 1` は「著者が留保を表明している」
 * で、この server はそれを読んで返すだけであり、読む・読まないの判断を呼び出し側から奪わない。
 *
 * XML は正規表現で読む。XMP は RDF/XML で、同じプロパティを属性（`pdfuaid:part="1"`）と
 * 要素（`<pdfuaid:part>1</pdfuaid:part>`）のどちらでも書けるので（XMP Part 1 §7.9.2）、
 * 両方の形を見る。XML パーサを足さないのは、依存を増やさないためと、必要なのが
 * 数個の既知プロパティの値だけだからである。
 */

import { asDict, decodedBytes, get, nameOf, tryGet } from '@normativepdf/recover';
import type { CosDict, PdfDocument } from 'normativepdf';
import type { XmpDeclarations, XmpMetadataInfo } from '../types.js';
import { lockedOut, openPdf } from './recover-service.js';

/** 名前空間 URI。XMP は prefix ではなく URI で名前空間を識別する（prefix は書き手が選べる）。 */
export const XMP_NAMESPACES = {
  pdfaid: 'http://www.aiim.org/pdfa/ns/id/',
  pdfuaid: 'http://www.aiim.org/pdfua/ns/id/',
  /** W3C TDM Reservation Protocol (TDMRep), Community Group Report. */
  tdm: 'http://www.w3.org/ns/tdmrep#',
} as const;

/** `include_xmp` で本体を返すときの上限（バイト）。XMP は通常数 KB、パケット全体でも数十 KB。 */
export const XMP_RETURN_LIMIT = 65_536;

/**
 * カタログの `/Metadata` を読む。
 *
 * - キーが無い → `null`（XMP が**無い**。観測できた事実）
 * - キーはあるが解決できない・ストリームでない・復号できない → `{ status: 'unreadable', ... }`
 * - 読めた → `{ status: 'read', ... }`
 *
 * 「無い」と「読めなかった」を 1 つの `null` に畳まない（#26 と同じ線）。
 */
export async function readXmpMetadata(
  doc: PdfDocument,
  catalog: CosDict | null,
): Promise<XmpMetadataInfo | null> {
  if (!catalog?.entries.has('Metadata')) return null;

  const lookup = await tryGet(doc, catalog, 'Metadata');
  if (lookup.unreadable) {
    return { status: 'unreadable', reason: 'the /Metadata reference could not be resolved' };
  }
  const value = lookup.value;
  if (value?.kind !== 'stream') {
    return {
      status: 'unreadable',
      reason: `/Metadata is ${value ? `a ${value.kind}` : 'null'}, not a stream (ISO 32000-2 §14.3.2)`,
    };
  }
  const subtype = nameOf(get(value.dict, 'Subtype'));
  const { bytes, unreadable } = await decodedBytes(doc, value);
  if (unreadable || !bytes) {
    return { status: 'unreadable', reason: 'the /Metadata stream could not be decoded' };
  }

  const xml = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return {
    status: 'read',
    bytes: bytes.length,
    subtype,
    namespaces: collectNamespaces(xml),
    declarations: parseDeclarations(xml),
    xml,
  };
}

/** `xmlns:prefix="uri"` を全部集める。prefix は書き手が選ぶので、URI のほうを返す。 */
export function collectNamespaces(xml: string): { prefix: string; uri: string }[] {
  const seen = new Map<string, string>();
  for (const m of xml.matchAll(/xmlns:([A-Za-z_][\w.-]*)\s*=\s*["']([^"']+)["']/g)) {
    if (!seen.has(m[1])) seen.set(m[1], m[2]);
  }
  return [...seen].map(([prefix, uri]) => ({ prefix, uri }));
}

/**
 * 既知のプロパティの値を取り出す。
 *
 * prefix は宣言された名前空間 URI から逆引きする。`pdfuaid` という prefix を別の URI に
 * 束ねている文書は実務上まず無いが、逆に URI が正しくて prefix が違う文書はあり得る
 * （XMP の規則上は正当）。URI が宣言されていない prefix は慣用の綴りをそのまま使う
 * （宣言を省いた不正な XMP でも、値そのものは読めるようにしておく）。
 */
export function parseDeclarations(xml: string): XmpDeclarations {
  const prefixes = (uri: string, fallback: string): string[] => {
    const found = collectNamespaces(xml)
      .filter((n) => n.uri === uri)
      .map((n) => n.prefix);
    return found.length > 0 ? found : [fallback];
  };

  const pdfaid = prefixes(XMP_NAMESPACES.pdfaid, 'pdfaid');
  const pdfuaid = prefixes(XMP_NAMESPACES.pdfuaid, 'pdfuaid');
  const tdm = prefixes(XMP_NAMESPACES.tdm, 'tdm');

  const pdfaPartRaw = stringProperty(xml, pdfaid, 'part');
  const pdfaConformance = stringProperty(xml, pdfaid, 'conformance');
  const pdfuaPartRaw = stringProperty(xml, pdfuaid, 'part');
  const reservationRaw = stringProperty(xml, tdm, 'reservation');
  const policy = stringProperty(xml, tdm, 'policy');

  // ブロックの有無は「プロパティが書いてあるか」で決める。書いてあるが整数でない値は
  // `part: null` として残す —— 「宣言が無い」と「宣言が壊れている」は別の観測である。
  return {
    pdfaid:
      pdfaPartRaw === null && pdfaConformance === null
        ? null
        : { part: asInteger(pdfaPartRaw), conformance: pdfaConformance },
    pdfuaid: pdfuaPartRaw === null ? null : { part: asInteger(pdfuaPartRaw) },
    tdm:
      reservationRaw === null && policy === null
        ? null
        : { reservation: asInteger(reservationRaw), policy },
  };
}

/** 属性形と要素形の両方を見て、最初に見つかった値を返す。 */
function stringProperty(xml: string, prefixes: string[], local: string): string | null {
  for (const p of prefixes) {
    const name = `${escapeRegExp(p)}:${escapeRegExp(local)}`;
    const attr = new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`).exec(xml);
    if (attr) return attr[1];
    const elem = new RegExp(`<${name}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</${name}>`).exec(xml);
    if (elem) return elem[1];
  }
  return null;
}

function asInteger(raw: string | null): number | null {
  if (raw === null) return null;
  return /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `summarize` 用の読み口（#29）: ファイルを開いて宣言だけを返す。
 *
 * - `/Metadata` が無い → すべて `null` のブロック（読めた上で「宣言が無い」）
 * - 読めなかった → 例外。呼び出し側の `half` が `failed` として射程に残す
 *   （`null` で返すと「宣言が無い」と区別できなくなる）
 */
export async function readXmpDeclarations(filePath: string): Promise<XmpDeclarations> {
  const { doc, scope } = await openPdf(filePath);
  if (lockedOut(scope)) {
    throw new Error(
      'The document is encrypted and the key could not be derived from the empty user password ' +
        '(ISO 32000-2 §7.6.4.3.2); the catalog and its /Metadata could not be read.',
    );
  }
  const catalog = asDict(await doc.getCatalog().catch(() => null));
  if (!catalog) throw new Error('The catalog dictionary could not be read (ISO 32000-2 §7.7.2).');
  const info = await readXmpMetadata(doc, catalog);
  if (info === null) return { pdfaid: null, pdfuaid: null, tdm: null };
  if (info.status === 'unreadable') throw new Error(`/Metadata could not be read: ${info.reason}`);
  return info.declarations;
}
