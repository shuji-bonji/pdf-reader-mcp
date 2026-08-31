/**
 * `@normativepdf/recover` の上に立つ読み口。**pdf-lib 撤去の受け皿**である。
 *
 * pdf-lib は「読めたか」を返さない —— 読めなかったものを黙って落とし、
 * 呼び出し側は `catch` で `false` を返すしかなかった。recover の `openDocument` は
 * `DocumentScope` で「どこまで読んだか」を申告するので、0.14.0 で `ReadingScope` に
 * 入れた「行われなかった読み」と同じ形で扱える。
 *
 * 🔴 このファイルは**判定を書かない**。`scope` は「どこまで読んだか」であって
 * 「条文に適合しているか」ではない（ADR-0010）。適合の判定は呼び出し側にある。
 *
 * L1（2026-08-31）では `detectEncryption` 1 本だけを移した。振る舞いは変えていない
 * —— 引数も戻り値も、読めなかったときに `false` を返すことも、pdf-lib 版のままである。
 * 撤去の A/B が「pdf-lib と recover の答えの違い」だけを写すようにするためで、
 * 握り潰しを直すのは A/B を採ったあとの別の段に置く（§L1 の後）。
 */

import {
  asArray,
  type DocumentScope,
  numberOf,
  type OpenedDocument,
  openDocument,
  resolved,
} from '@normativepdf/recover';
import { type CosObject, inheritedAttribute, type PageEntry, type PdfDocument } from 'normativepdf';
import type { ObjectRect } from '../types.js';
import { readPdfFile } from '../utils/pdf-helpers.js';

export type { DocumentScope, OpenedDocument };

/**
 * ファイルを開く。`loadWithPdfLib` の置き換え先で、**`scope` を捨てない**のが違いである。
 *
 * pdf-lib 版は `PDFDocument` だけを返していたので、呼び出し側は
 * 「読めたのか」「どこまで読めたのか」を訊けなかった。`scope` は
 * `recovered` / `authenticated` / `chainStop` などを持つ（判定ではなく射程）。
 */
export async function openPdf(filePath: string): Promise<OpenedDocument> {
  return openDocument(await readPdfFile(filePath));
}

/** バイト列から開く（`read_url` はパスを持たない）。 */
export async function openPdfFromData(data: Uint8Array): Promise<OpenedDocument> {
  return openDocument(data);
}

/**
 * 暗号化されていて鍵が導けなかったか。**このとき間接オブジェクトは 1 つも読めない**
 * —— normativepdf は暗号文を平文の顔で返さない（ADR-0008）。
 * pdf-lib の `ignoreEncryption: true` は復号せずに構造だけ歩けたので、ここは
 * 振る舞いが変わる。読めなかったことを申告するのは呼び出し側の仕事である。
 */
export function lockedOut(scope: DocumentScope): boolean {
  return scope.encrypted && !scope.authenticated;
}

/**
 * trailer に `/Encrypt` があるか（ISO 32000-2 §7.6）。
 *
 * 🔴 **読めなかったときも `false` を返す。** これは「暗号化されていない」ではなく
 * 「見に行けなかった」なのに、同じ顔をしている。pdf-lib 版からそのまま持ってきた
 * 振る舞いで、L1 の A/B で差が出ないようにするために残してある。
 * 呼び出し元は `pdfjs-service.ts` の `metadata.isEncrypted` 1 箇所だけで、
 * そこは `summarize` を経て pdf-read Phase 1 の停止条件になる。
 *
 * 鍵が導けるかは見ない（`scope.authenticated`）。`/Encrypt` の有無は §7.6.2 が
 * 暗号化の対象から外しているので、パスワード無しでも読める。
 */
export async function detectEncryption(filePath: string): Promise<boolean> {
  try {
    const { scope } = await openDocument(await readPdfFile(filePath));
    return scope.encrypted;
  } catch {
    return false;
  }
}

/* ---------------- ページの箱（locate_objects と extract_structured_text が共有する） ---------------- */

export async function numberArray(
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
export async function pageBox(doc: PdfDocument, page: PageEntry): Promise<ObjectRect | null> {
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
