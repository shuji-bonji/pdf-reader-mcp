/**
 * 18 - 構造木の歩き（S2 で pdf-lib から @normativepdf/recover へ移した）
 *
 * ここが固定するのは、移行で**変わった 3 つ**である。3 つとも撤去前は通らない。
 *
 * 🔴 検体はバイト列で持つ。この 3 つの形はどれも既存のフィクスチャに無く、
 * 外部コーパスを要求すると、それが無い環境で検査が飛ぶ（飛んだ検査は「通った」ではない）。
 */

import { openDocument } from '@normativepdf/recover';
import { describe, expect, it } from 'vitest';
import { collectContentRefs, walkStructTree } from '../../src/services/struct-tree-walker.js';

/** `/K` が 5 → 6 → 5 で循環している構造木。pdf-lib 版は見張りが無く止まらなかった。 */
const CYCLIC_K =
  'JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgL1N0cnVjdFRyZWVSb290IDQgMCBSIC9NYXJrSW5mbyA8PCAvTWFya2VkIHRydWUgPj4gPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMTAwXSA+PgplbmRvYmoKNCAwIG9iago8PCAvVHlwZSAvU3RydWN0VHJlZVJvb3QgL0sgWzUgMCBSXSA+PgplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvU3RydWN0RWxlbSAvUyAvRG9jdW1lbnQgL0sgWzYgMCBSXSA+PgplbmRvYmoKNiAwIG9iago8PCAvVHlwZSAvU3RydWN0RWxlbSAvUyAvU2VjdCAvSyBbNSAwIFJdID4+CmVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMTcyIDAwMDAwIG4gCjAwMDAwMDAyNDMgMDAwMDAgbiAKMDAwMDAwMDI5NyAwMDAwMCBuIAowMDAwMDAwMzYwIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNyAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDE5CiUlRU9GCg==';

/**
 * `/ActualText` が UTF-8 のバイト順マークで始まり（§7.9.2.2.1・PDF 2.0）、
 * 役割名に `#c2` の 16 進エスケープが入っている（§7.3.5）文書。
 */
const BOM_AND_HEX_NAME =
  'JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgL1N0cnVjdFRyZWVSb290IDQgMCBSIC9NYXJrSW5mbyA8PCAvTWFya2VkIHRydWUgPj4gPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMTAwXSA+PgplbmRvYmoKNCAwIG9iago8PCAvVHlwZSAvU3RydWN0VHJlZVJvb3QgL0sgWzUgMCBSXSA+PgplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvU3RydWN0RWxlbSAvUyAvRG9jdW1lbnQgL0sgWzYgMCBSXSA+PgplbmRvYmoKNiAwIG9iago8PCAvVHlwZSAvU3RydWN0RWxlbSAvUyAvUmVjdGFuZ2xlI2MyIC9QZyAzIDAgUiAvQWN0dWFsVGV4dCAoXDM1N1wyNzNcMjc3Y2FmXDMwM1wyNTEpIC9LIDAgPj4KZW5kb2JqCnhyZWYKMCA3CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAxNzIgMDAwMDAgbiAKMDAwMDAwMDI0MyAwMDAwMCBuIAowMDAwMDAwMjk3IDAwMDAwIG4gCjAwMDAwMDAzNjAgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA3IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0NjkKJSVFT0YK';

async function walk(base64: string) {
  const { doc, scope } = await openDocument(Buffer.from(base64, 'base64'));
  return walkStructTree(doc, scope.encrypted);
}

describe('18 - struct-tree-walker（recover 版）', () => {
  // ST-1: 循環しても止まる。pdf-lib 版は見張りが無く、この検体で戻ってこなかった。
  //
  // 🔴 「落ちない」ではなく「**終わる**」を測る。止まらないのは例外ではないので
  // try/catch には掛からない。しかも下の `Promise.race` のタイマーも動かない ——
  // 無限の await はマイクロタスクを詰めるので、マクロタスクである setTimeout に
  // 順番が回らない。つまり**この試験は落ちずにハングする**。
  // だから見張りは 2 枚ある: 参照番号（`ancestors`）と、深さの上限
  // （`MAX_STRUCT_DEPTH`）。番号を持たない直接オブジェクトの循環は前者を素通りする。
  // 深さの上限を外すとこの試験はハングし、番号の見張りを外すと下の children が伸びる。
  it('ST-1: a cyclic /K terminates instead of recursing forever', async () => {
    const done = walk(CYCLIC_K).then(() => 'done' as const);
    const timeout = new Promise<'hung'>((r) => setTimeout(() => r('hung'), 5_000));
    expect(await Promise.race([done, timeout])).toBe('done');

    const roots = await walk(CYCLIC_K);
    expect(roots).not.toBeNull();
    // Document → Sect まで降り、そこで 5 0 R に戻る枝は切る
    expect(roots?.[0]?.role).toBe('Document');
    expect(roots?.[0]?.children[0]?.role).toBe('Sect');
    expect(roots?.[0]?.children[0]?.children).toEqual([]);
    // 深さの上限だけで止めた場合はここが 200 段の入れ子になる。番号の見張りが効いている。
  });

  // ST-2: UTF-8 のバイト順マーク（§7.9.2.2.1・PDF 2.0）。
  // pdf-lib 1.x は PDFDocEncoding として読み、`ï»¿` を本文の頭に付けていた。
  it('ST-2: a UTF-8 BOM is consumed, not emitted as text (§7.9.2.2.1)', async () => {
    const roots = await walk(BOM_AND_HEX_NAME);
    const elem = roots?.[0]?.children[0];
    expect(elem?.actualText).toBe('café');
    expect(elem?.actualText).not.toMatch(/ï»¿|ï»¿/);
  });

  // ST-3: 名前の 16 進エスケープ（§7.3.5）。pdf-lib は `Rectangle#c2` を字面のまま返していた。
  // qpdf は書き戻すときに再びエスケープする = 値はバイト 0xC2 だと読んでいる。
  it('ST-3: #xx in a name is decoded (§7.3.5)', async () => {
    const roots = await walk(BOM_AND_HEX_NAME);
    expect(roots?.[0]?.children[0]?.role).toBe('RectangleÂ');
    expect(roots?.[0]?.children[0]?.role).not.toBe('Rectangle#c2');
  });

  // ST-4: /Pg は継承する。/K の整数はその継承したページの MCID になる。
  it('ST-4: an integer /K becomes an MCID on the inherited /Pg', async () => {
    const roots = await walk(BOM_AND_HEX_NAME);
    const refs = collectContentRefs(roots?.[0] as never);
    expect(refs).toEqual([{ pageObjNum: 3, mcid: 0 }]);
  });
});
