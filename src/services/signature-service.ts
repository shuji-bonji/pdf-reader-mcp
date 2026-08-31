/**
 * 署名フィールドの**構造**を読む（`inspect_signatures`）。
 *
 * 🔴 **暗号的な検証はしない。** 「この署名は有効か」は pdf-verify-mcp の
 * `verify_signatures` が答える。ここが答えるのは「フォームにどんな署名
 * フィールドがあり、値が入っているか」だけで、family の切り分けは前から
 * そうなっている（ツールの description にも書いてある）。
 *
 * 読む範囲は §12.7.4.2 のフォームフィールドの木である: 目録の `/AcroForm`
 * → `/Fields` → `/Kids`。文書の中に散らばっている `/FT /Sig` の辞書を
 * 数え上げるのとは**別の問い**で、そちらは「フォームに繋がっていない孤児」
 * まで拾う（pdf-verify-mcp の `collectFieldNames` がその読み方をする）。
 *
 * ## S4（2026-08-31）で変わったこと
 *
 * pdf-lib の `PDFAcroForm.getAllFields()` を自前に置き換えた。範囲は合わせて
 * ある（下のコメント参照）が、**見張りを 2 枚足した**。pdf-lib 版には 1 枚も
 * 無く、`/Kids` や `/Parent` が循環している文書では再帰が止まらない。
 * 止まらないのは例外ではないので try/catch にも試験の timeout にも掛からない
 * —— サーバは以後どの呼び出しにも答えなくなる（0.14.0 の `render_page` と
 * S2 の構造木で 2 度踏んだ形である）。
 */

import { asArray, asDict, get, nameOf, refKey, resolved, textOf } from '@normativepdf/recover';
import type { CosDict, PdfDocument } from 'normativepdf';
import type { SignatureFieldInfo, SignaturesAnalysis } from '../types.js';
import { lockedOut, openPdf } from './recover-service.js';

/**
 * 名前を持たない枝を降りる深さの上限。
 *
 * 参照番号の見張り（`ancestors`）は**番号を持つ枝**の循環しか止められない。
 * `/Kids` に直接辞書が書かれていると番号が無いので素通りする。
 * 実文書を切っていないことは A/B で測る（フォームの入れ子は数段しかない）。
 */
const MAX_FIELD_DEPTH = 64;

/** 走査中の 1 フィールド。`name` は §12.7.4.2 の完全修飾名。 */
interface WalkedField {
  dict: CosDict;
  /** 祖先の `/T` を `.` で繋いだ名前（pdf-lib の `getFullyQualifiedName` と同じ）。 */
  name: string | null;
}

/**
 * Analyze digital signature fields.
 */
export async function analyzeSignatures(filePath: string): Promise<SignaturesAnalysis> {
  const { doc, scope } = await openPdf(filePath);

  // 🔴 **「AcroForm が無い」と言う前に、目録が読めたかを見る。**
  // 鍵が導けないと目録も読めないので（ADR-0008）、`AcroForm` を引くと必ず
  // 空になる。そこで「署名フィールドは 0 個」と答えると、署名されている文書を
  // 「署名されていない」と報告することになる。pdf-lib 版はこれを言っていた。
  if (lockedOut(scope)) {
    return {
      totalFields: 0,
      signedCount: 0,
      unsignedCount: 0,
      fields: [],
      note:
        'The document is encrypted and the key could not be derived from the empty user ' +
        'password (ISO 32000-2 §7.6.4.3.2), so the catalogue could not be read and no ' +
        'signature field could be looked for. This is not a document without signatures.',
    };
  }

  const catalog = asDict(await doc.getCatalog().catch(() => null));
  const acroForm = asDict(await resolved(doc, get(catalog, 'AcroForm')));

  if (!acroForm) {
    return {
      totalFields: 0,
      signedCount: 0,
      unsignedCount: 0,
      fields: [],
      note: 'No AcroForm found in the document.',
    };
  }

  const fields: SignatureFieldInfo[] = [];
  for (const walked of await walkFields(doc, acroForm)) {
    // Signature fields only (ISO 32000-2 §12.7.5.5: FT shall be Sig).
    // 🔴 `/FT` は継承する属性だが、pdf-lib 版はこの辞書のものしか見ていなかった。
    // 継承を足すと拾う件数が変わるので、撤去の A/B に別の変更が混ざる。
    // そこは変えていない —— 継承を読むかは S4 のあとの別の問いである。
    if (nameOf(await resolved(doc, get(walked.dict, 'FT'))) !== 'Sig') continue;

    const vObj = get(walked.dict, 'V');
    let isSigned = false;
    let signerName: string | null = null;
    let reason: string | null = null;
    let location: string | null = null;
    let contactInfo: string | null = null;
    let signingTime: string | null = null;
    let filter: string | null = null;
    let subFilter: string | null = null;

    // If V exists, the field has been signed
    if (vObj !== undefined) {
      isSigned = true;
      const sigDict = asDict(await resolved(doc, vObj));
      if (sigDict) {
        // 🔴 pdf-lib 版はここで参照を解決していなかった（`dict.get`）。
        // 署名辞書の中の文字列が間接参照で書かれている文書では null になる。
        // そこは変えていない。
        signerName = directText(sigDict, 'Name');
        reason = directText(sigDict, 'Reason');
        location = directText(sigDict, 'Location');
        contactInfo = directText(sigDict, 'ContactInfo');
        signingTime = directText(sigDict, 'M');
        filter = nameOf(await resolved(doc, get(sigDict, 'Filter')));
        subFilter = nameOf(await resolved(doc, get(sigDict, 'SubFilter')));
      }
    }

    fields.push({
      fieldName: walked.name ?? '(unnamed)',
      isSigned,
      signerName,
      reason,
      location,
      contactInfo,
      signingTime,
      filter,
      subFilter,
    });
  }

  const signedCount = fields.filter((f) => f.isSigned).length;
  return {
    totalFields: fields.length,
    signedCount,
    unsignedCount: fields.length - signedCount,
    fields,
    note: 'Cryptographic signature verification is not performed. Only field structure is inspected.',
  };
}

/**
 * `/Fields` から木を降り、通ったフィールドを**親も子も**返す（§12.7.4.2）。
 *
 * pdf-lib の `getAllFields()` と範囲を合わせてある:
 *
 *  - `/Fields` の要素は辞書でなければ落とす
 *  - **「非端末」の判定は `/Kids` の要素が `/T` を持つかどうか**である。
 *    `/Kids` があっても、その要素が `/T` を持たなければウィジェット注釈と
 *    みなして降りない（§12.7.4.1: 1 つのフィールドが複数の注釈を持つ形）
 *  - `/Kids` の要素は**間接参照で書かれた辞書だけ**を降りる。直接辞書の子は
 *    pdf-lib が落としていたので、ここでも落とす
 */
async function walkFields(doc: PdfDocument, acroForm: CosDict): Promise<WalkedField[]> {
  const out: WalkedField[] = [];
  const roots = asArray(await resolved(doc, get(acroForm, 'Fields')));
  if (!roots) return out;

  for (const entry of roots.items) {
    const dict = asDict(await resolved(doc, entry));
    if (!dict) continue;
    // 🔴 根そのものを見張りに入れてから降りる。入れ忘れると、根に戻る循環が
    // 1 周だけ通って同じフィールドが 2 回出る（止まりはするので、
    // 「見張りが効いている」と読めてしまう）。
    const seen = new Set<string>();
    if (entry.kind === 'ref') seen.add(refKey(entry));
    await descend(doc, dict, null, seen, 0, out);
  }
  return out;
}

async function descend(
  doc: PdfDocument,
  dict: CosDict,
  parentName: string | null,
  /** この枝で通った参照番号。**枝ごと**に見張るので、非循環の文書では出力が変わらない。 */
  ancestors: ReadonlySet<string>,
  depth: number,
  out: WalkedField[],
): Promise<void> {
  if (depth > MAX_FIELD_DEPTH) return;

  const partial = textOf(await resolved(doc, get(dict, 'T')));
  // pdf-lib の `getFullyQualifiedName()`: 親があれば `親.自分`、無ければ自分の `/T`。
  const name = parentName === null ? partial : `${parentName}.${partial}`;
  out.push({ dict, name });

  const kids = asArray(await resolved(doc, get(dict, 'Kids')));
  if (!kids) return;

  // 「非端末か」= /Kids の要素のどれかが /T を持つ辞書か（pdf-lib と同じ判定）。
  let nonTerminal = false;
  for (const kid of kids.items) {
    const kidDict = asDict(await resolved(doc, kid));
    if (kidDict && get(kidDict, 'T') !== undefined) {
      nonTerminal = true;
      break;
    }
  }
  if (!nonTerminal) return;

  for (const kid of kids.items) {
    // pdf-lib は間接参照で書かれた子だけを降りた。
    if (kid.kind !== 'ref') continue;
    const key = refKey(kid);
    if (ancestors.has(key)) continue;
    const kidDict = asDict(await resolved(doc, kid));
    if (!kidDict) continue;
    const next = new Set(ancestors);
    next.add(key);
    await descend(doc, kidDict, name, next, depth + 1, out);
  }
}

/**
 * 辞書から**直接値**を文字列として読む。参照は解決しない。
 *
 * pdf-lib 版の `extractStringFromDict` と同じ範囲で、文字列オブジェクトと
 * 名前オブジェクトの両方を受ける（`/M` は日付文字列、`/Name` は文字列）。
 */
function directText(dict: CosDict, key: string): string | null {
  const value = get(dict, key);
  if (value === undefined) return null;
  return textOf(value) ?? nameOf(value);
}
