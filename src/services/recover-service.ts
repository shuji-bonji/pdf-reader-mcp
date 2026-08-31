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

import { openDocument } from '@normativepdf/recover';
import { readPdfFile } from '../utils/pdf-helpers.js';

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
