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

import { type DocumentScope, type OpenedDocument, openDocument } from '@normativepdf/recover';
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
