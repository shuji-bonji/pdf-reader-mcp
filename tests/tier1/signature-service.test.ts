/**
 * 署名フィールドの木を降りるときの見張り（S4・2026-08-31）。
 *
 * pdf-lib の `PDFAcroForm.getAllFields()` には巡回の見張りが 1 枚も無く、
 * `/Kids` が循環している文書では再帰が止まらなかった。`getFullyQualifiedName()`
 * も `/Parent` を見張り無しで辿る。
 *
 * 🔴 **止まらないのは例外ではない。** try/catch にも試験の timeout にも
 * 掛からない —— 無限の await はマイクロタスクを詰めるので、マクロタスクである
 * `setTimeout` に順番が回らない。試験は落ちずにハングする。だからここは
 * 「落ちる試験」ではなく「返ってくることを確かめる試験」として書いてある:
 * 見張りを外すと、この試験は失敗するのではなく**終わらない**。
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeSignatures } from '../../src/services/signature-service.js';

/**
 * `/Kids` が互いを指す 2 つの署名フィールド（obj 5 と obj 6）。
 *
 * 5 の `/Kids` は 6 を、6 の `/Kids` は 5 を指す。どちらも `/T` を持つので
 * pdf-lib の「非端末」判定（`/Kids` の要素が `/T` を持つ辞書か）が真になり、
 * 見張りが無ければ 5 → 6 → 5 → … と降り続ける。
 *
 * バイト列をここに置いてあるのは、外の道具に依らずこの試験が回るためである。
 * 🔴 sha が合わなくなったら、測っているものが変わったということ。
 */
const CYCLIC_ACROFORM = {
  name: 'acroform-kids-cycle.pdf',
  sha256: '7229327d7802934078f21b1987c94fba',
  base64:
    'JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgL0Fjcm9Gb3JtIDw8IC9GaWVsZHMgWzUgMCBSXSAvU2lnRmxhZ3MgMyA+PiA+PgplbmRvYmoKMiAwIG9iago8PCAvVHlwZSAvUGFnZXMgL0tpZHMgWzMgMCBSXSAvQ291bnQgMSA+PgplbmRvYmoKMyAwIG9iago8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDU5NSA4NDJdIC9Db250ZW50cyA0IDAgUiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDAgPj4Kc3RyZWFtCgplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL0ZUIC9TaWcgL1QgKG91dGVyKSAvS2lkcyBbNiAwIFJdID4+CmVuZG9iago2IDAgb2JqCjw8IC9GVCAvU2lnIC9UIChpbm5lcikgL0tpZHMgWzUgMCBSXSAvUGFyZW50IDUgMCBSID4+CmVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDEwOCAwMDAwMCBuIAowMDAwMDAwMTY1IDAwMDAwIG4gCjAwMDAwMDAyNTIgMDAwMDAgbiAKMDAwMDAwMDMwMSAwMDAwMCBuIAowMDAwMDAwMzU2IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNyAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDI1CiUlRU9GCg==',
};

let cyclicPath = '';

beforeAll(() => {
  const bytes = Buffer.from(CYCLIC_ACROFORM.base64, 'base64');
  expect(createHash('sha256').update(bytes).digest('hex').slice(0, 32)).toBe(
    CYCLIC_ACROFORM.sha256,
  );
  cyclicPath = join(mkdtempSync(join(tmpdir(), 'sigcycle-')), CYCLIC_ACROFORM.name);
  writeFileSync(cyclicPath, bytes);
});

describe('analyzeSignatures — 巡回の見張り', () => {
  it('SC-1: /Kids が循環している AcroForm でも返る', async () => {
    const result = await analyzeSignatures(cyclicPath);
    // 枝ごとの見張りなので、5 → 6 まで降りて 6 → 5 で止まる。
    expect(result.totalFields).toBe(2);
    expect(result.fields.map((f) => f.fieldName)).toEqual(['outer', 'outer.inner']);
  });

  it('SC-2: 循環していても、署名の有無は正しく答える', async () => {
    const result = await analyzeSignatures(cyclicPath);
    // どちらのフィールドにも /V が無いので未署名。
    expect(result.signedCount).toBe(0);
    expect(result.unsignedCount).toBe(2);
  });
});
