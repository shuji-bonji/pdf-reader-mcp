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
import type { DocumentMetadataField, XmpDeclarations, XmpMetadataInfo } from '../types.js';
import { lockedOut, openPdf } from './recover-service.js';

/**
 * 名前空間 URI。XMP は prefix ではなく URI で名前空間を識別する（prefix は書き手が選べる）。
 *
 * TDMRep は 2 つ書いてある。W3C Final Community Group Report（2024-05-10）の §6.6（PDF）は
 * `http://www.w3.org/ns/tdmrep/`（末尾スラッシュ）、§6.5（EPUB 3）は `http://www.w3.org/ns/tdmrep#`
 * と書いていて、文書の中で揃えていない。PDF の書き手がどちらを写すかは決められないので両方を受ける。
 */
export const XMP_NAMESPACES = {
  pdfaid: ['http://www.aiim.org/pdfa/ns/id/'],
  pdfuaid: ['http://www.aiim.org/pdfua/ns/id/'],
  tdm: ['http://www.w3.org/ns/tdmrep/', 'http://www.w3.org/ns/tdmrep#'],
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
  const prefixes = (uris: readonly string[], fallback: string): string[] => {
    const found = collectNamespaces(xml)
      .filter((n) => uris.includes(n.uri))
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

// ─── get_metadata（#42）: 文書情報辞書の 8 項目に対応する XMP のプロパティ ───

/** `get_metadata` の 8 項目。文書情報辞書（§14.3.3）のキーと同じ並び。 */
export const DOCUMENT_METADATA_FIELDS: readonly DocumentMetadataField[] = [
  'title',
  'author',
  'subject',
  'keywords',
  'creator',
  'producer',
  'creationDate',
  'modificationDate',
];

/**
 * ISO 32000-2 Table 349 の注が、文書情報辞書の各キーに対応させている XMP のプロパティ。
 * 名前空間は URI で引く（prefix は書き手が選べる）。
 */
const XMP_PROPERTY_OF: Record<
  DocumentMetadataField,
  { ns: string; fallback: string; local: string }
> = {
  title: { ns: 'http://purl.org/dc/elements/1.1/', fallback: 'dc', local: 'title' },
  author: { ns: 'http://purl.org/dc/elements/1.1/', fallback: 'dc', local: 'creator' },
  subject: { ns: 'http://purl.org/dc/elements/1.1/', fallback: 'dc', local: 'description' },
  keywords: { ns: 'http://ns.adobe.com/pdf/1.3/', fallback: 'pdf', local: 'Keywords' },
  creator: { ns: 'http://ns.adobe.com/xap/1.0/', fallback: 'xmp', local: 'CreatorTool' },
  producer: { ns: 'http://ns.adobe.com/pdf/1.3/', fallback: 'pdf', local: 'Producer' },
  creationDate: { ns: 'http://ns.adobe.com/xap/1.0/', fallback: 'xmp', local: 'CreateDate' },
  modificationDate: { ns: 'http://ns.adobe.com/xap/1.0/', fallback: 'xmp', local: 'ModifyDate' },
};

const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

/** XML の文字参照を戻す。 */
function decodeXmlText(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, ref: string) => {
    if (ref[0] === '#') {
      const code =
        ref[1] === 'x' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[ref] ?? '';
  });
}

/**
 * 1 つのプロパティの値。属性の形と要素の形の両方を見る（XMP Part 1 §7.9.2）。
 *
 * - `rdf:Alt`（言語ごと）は `xml:lang="x-default"` の項目、無ければ最初の項目
 * - `rdf:Seq`・`rdf:Bag` は項目を `; ` でつなぐ
 *
 * 🔴 pdfjs の `getMetadata().metadata` は `rdf:Alt` の項目を区切りなしでつなぎ、
 * 属性の形を読まない（2026-11-05 実測）。ここで読む理由はそれである。
 */
function xmpProperty(xml: string, prefixes: string[], rdf: string[], local: string): string | null {
  for (const p of prefixes) {
    const name = `${escapeRegExp(p)}:${escapeRegExp(local)}`;
    const attr = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"|\\s${name}\\s*=\\s*'([^']*)'`).exec(xml);
    if (attr) return decodeXmlText(attr[1] ?? attr[2] ?? '').trim();
    const elem = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
    if (!elem) continue;
    const inner = elem[1];
    for (const r of rdf) {
      const R = escapeRegExp(r);
      const container = new RegExp(`<${R}:(Alt|Seq|Bag)(?:\\s[^>]*)?>([\\s\\S]*?)</${R}:\\1>`).exec(
        inner,
      );
      if (!container) continue;
      const items = [
        ...container[2].matchAll(new RegExp(`<${R}:li(\\s[^>]*)?>([\\s\\S]*?)</${R}:li>`, 'g')),
      ].map((m) => ({
        lang: /xml:lang\s*=\s*["']([^"']*)["']/.exec(m[1] ?? '')?.[1] ?? null,
        text: decodeXmlText(m[2]).trim(),
      }));
      if (items.length === 0) return null;
      if (container[1] === 'Alt') {
        return (items.find((i) => i.lang === 'x-default') ?? items[0]).text;
      }
      return items.map((i) => i.text).join('; ');
    }
    return decodeXmlText(inner.replace(/<[^>]*>/g, '')).trim();
  }
  return null;
}

/** XMP の packet から 8 項目を取り出す。無い項目・空の項目は `null`。 */
export function parseDocumentMetadata(xml: string): Record<DocumentMetadataField, string | null> {
  const namespaces = collectNamespaces(xml);
  const prefixesFor = (uri: string, fallback: string): string[] => {
    const found = namespaces.filter((n) => n.uri === uri).map((n) => n.prefix);
    return found.length > 0 ? found : [fallback];
  };
  const rdf = prefixesFor(RDF_NS, 'rdf');
  const out = {} as Record<DocumentMetadataField, string | null>;
  for (const field of DOCUMENT_METADATA_FIELDS) {
    const { ns, fallback, local } = XMP_PROPERTY_OF[field];
    const value = xmpProperty(xml, prefixesFor(ns, fallback), rdf, local);
    out[field] = value === null || value === '' ? null : value;
  }
  return out;
}

/** `get_metadata` の XMP の読み取り結果。読めなかったことを「無い」と同じ顔にしない。 */
export type DocumentXmp =
  | { status: 'read'; fields: Record<DocumentMetadataField, string | null> }
  | { status: 'absent' }
  | { status: 'unreadable'; reason: string };

/** ファイルを開き、catalog の `/Metadata` から 8 項目を読む（#42）。例外は投げない。 */
export async function readDocumentXmp(filePath: string): Promise<DocumentXmp> {
  try {
    const { doc, scope } = await openPdf(filePath);
    if (lockedOut(scope)) {
      return {
        status: 'unreadable',
        reason:
          'the document is encrypted and the key could not be derived from the empty user ' +
          'password (ISO 32000-2 §7.6.4.3.2), so the catalog and its /Metadata could not be read',
      };
    }
    const catalog = asDict(await doc.getCatalog().catch(() => null));
    if (!catalog) {
      return {
        status: 'unreadable',
        reason: 'the catalog dictionary could not be read (ISO 32000-2 §7.7.2)',
      };
    }
    const info = await readXmpMetadata(doc, catalog);
    if (info === null) return { status: 'absent' };
    if (info.status === 'unreadable') return { status: 'unreadable', reason: info.reason };
    return { status: 'read', fields: parseDocumentMetadata(info.xml ?? '') };
  } catch (error) {
    return {
      status: 'unreadable',
      reason: `the file could not be opened to read /Metadata: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
