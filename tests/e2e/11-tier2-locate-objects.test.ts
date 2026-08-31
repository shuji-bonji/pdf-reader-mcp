/**
 * 11 - Tier 2 locate_objects E2E Tests
 *
 * LO-1〜LO-7: locate_objects (locateObjects) — Issue #20 / family gap G-A.
 *
 * このツールは「オブジェクト番号 → 座標」の橋渡しであり、UC-10 の後半にあたる。
 * 前半（どのオブジェクトが変わったか）は pdf-verify-mcp の verify_integrity。
 *
 * テストは**オブジェクト番号を直書きしない**。番号はフィクスチャ生成側の都合で
 * 動くので、そこに固定すると「フィクスチャを作り直したら落ちる」テストになる。
 * 広い範囲を投げて、返ってきた性質（Subtype / basis / page）で判定する。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { locateObjects } from '../../src/services/object-locator.js';
import { HALVES_SPECIMENS } from './halves-specimens.js';
import { FIXTURES } from './setup.js';

const SCRATCH = mkdtempSync(join(tmpdir(), 'locate-objects-'));

function writeSpecimen(name: string, base64: string): string {
  const p = join(SCRATCH, name);
  writeFileSync(p, Buffer.from(base64, 'base64'));
  return p;
}

/**
 * 相互参照表が 4 0 R を名指ししているのに、その値が null オブジェクトである文書
 * （ISO 32000-2 §7.3.9）。qpdf も `null` と言う。
 * バイト列をここに置くのは、この形が既存のフィクスチャに 1 件も無いためである。
 */
const NULL_VALUED_OBJECT =
  'JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMTAwXSA+PgplbmRvYmoKNCAwIG9iagpudWxsCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA2NCAwMDAwMCBuIAowMDAwMDAwMTIxIDAwMDAwIG4gCjAwMDAwMDAxOTIgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA1IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgoyMTIKJSVFT0YK';

/** 総当たり用のオブジェクト番号。フィクスチャはどれも十分小さい。 */
const RANGE = Array.from({ length: 30 }, (_, i) => i + 1);

describe('11 - locate_objects', () => {
  // LO-1: 注釈は自分の /Rect を持つ = 唯一の「正確な」座標
  it('LO-1: an annotation is located by its own /Rect, on the page that lists it', async () => {
    const { objects } = await locateObjects(FIXTURES.annotated, RANGE);
    const annotations = objects.filter((o) => o.type === 'Annot');
    expect(annotations.length).toBeGreaterThan(0);

    for (const annotation of annotations) {
      expect(annotation.found).toBe(true);
      expect(annotation.locations.length).toBeGreaterThan(0);
      for (const location of annotation.locations) {
        expect(location.basis).toBe('annotation-rect');
        expect(location.page).not.toBeNull();
        expect(location.rect).not.toBeNull();
      }
    }
  });

  // LO-2: 矩形は add_annotation がそのまま受け取れる形（正規化済み）
  // ISO 32000-1 §7.9.5「対角の 2 点を任意の順で書いてよい / 使用前に正規化する」
  it('LO-2: rectangles are normalised to x1 < x2 and y1 < y2', async () => {
    const { objects } = await locateObjects(FIXTURES.annotated, RANGE);
    const rects = objects.flatMap((o) => o.locations.map((l) => l.rect)).filter((r) => r !== null);
    expect(rects.length).toBeGreaterThan(0);
    for (const rect of rects) {
      expect(rect.x1).toBeLessThanOrEqual(rect.x2);
      expect(rect.y1).toBeLessThanOrEqual(rect.y2);
    }
  });

  // LO-3: コンテンツストリームは「ページ全体」しか言えない。
  // ここを annotation-rect と同じ顔で返すと、ページ全体を指す矩形が
  // 「変更箇所の矩形」として読まれる。basis を分けている理由。
  it('LO-3: a content stream yields the whole page, and says so', async () => {
    const { objects } = await locateObjects(FIXTURES.annotated, RANGE);
    const contentStreams = objects.filter((o) =>
      o.locations.some((l) => l.basis === 'page-content-stream'),
    );
    expect(contentStreams.length).toBeGreaterThan(0);
    for (const object of contentStreams) {
      expect(object.reason).toMatch(/whole page/);
      expect(object.reason).toMatch(/content-stream walk/);
    }
  });

  // LO-4: リソース（フォント・画像）に矩形は無い。ページだけを返す
  it('LO-4: a resource reports its page but no rectangle', async () => {
    const { objects } = await locateObjects(FIXTURES.multiFont, RANGE);
    const fonts = objects.filter((o) => o.type === 'Font');
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) {
      for (const location of font.locations) {
        expect(location.basis).toBe('page-resource');
        expect(location.rect).toBeNull();
      }
      expect(font.reason).toMatch(/no rectangle of its own/);
    }
  });

  // LO-5: 存在しない番号は「座標なし」ではなく「見つからない」。
  // リビジョンで free されたオブジェクトが渡ってくる経路があるので、
  // この 2 つを混ぜると「あるが位置不明」と誤読される。
  it('LO-5: a number with no object is found:false, not "no coordinates"', async () => {
    const { objects } = await locateObjects(FIXTURES.simple, [99_999]);
    expect(objects).toHaveLength(1);
    expect(objects[0].found).toBe(false);
    expect(objects[0].generation).toBeNull();
    expect(objects[0].locations).toHaveLength(0);
    expect(objects[0].reason).toMatch(/freed by a later revision/);
  });

  // LO-6: ページ自身は自分の箱を返す
  it('LO-6: a page object is located by its crop/media box', async () => {
    const { objects } = await locateObjects(FIXTURES.annotated, RANGE);
    const pages = objects.filter((o) => o.type === 'Page');
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(page.locations[0]?.basis).toBe('page-box');
      expect(page.locations[0]?.rect).not.toBeNull();
    }
  });

  // LO-7: 暗号化文書 — 数値と名前は非暗号（ISO 32000-1 §7.6.2）なので
  // 座標と型は信用できる。文字列は復号しないので fieldName は null にする
  // （pdf-lib の ignoreEncryption は復号せず暗号文をそのまま返す）。
  it('LO-7: coordinates survive encryption; field names are withheld, not garbled', async () => {
    const { objects, isEncrypted, notes } = await locateObjects(
      FIXTURES.encryptedActualText,
      RANGE,
    );
    expect(isEncrypted).toBe(true);
    expect(notes.join(' ')).toMatch(/7\.6\.2/);
    expect(objects.some((o) => o.found)).toBe(true);
    expect(objects.every((o) => o.fieldName === null)).toBe(true);
    // 型（名前オブジェクト）は読めている
    expect(objects.some((o) => o.type !== null)).toBe(true);
  });

  // ---- 以下 3 件は pdf-lib 撤去（S1）で入った。撤去前は 3 件とも通らない ----

  // LO-8: オブジェクトストリームと相互参照ストリーム**自身**も、番号を持つ
  // オブジェクトである。pdf-lib の enumerateIndirectObjects() はこの 2 つを
  // 返さず「この番号のオブジェクトは存在しない」と答えていた（実測 379 件）。
  // 🔴 qpdf --show-object も同じ番号に ObjStm / XRef を返す（独立オラクル）。
  it('LO-8: the /ObjStm and /XRef containers are themselves found', async () => {
    const { objects } = await locateObjects(FIXTURES.twoColumn, RANGE);
    const types = objects.filter((o) => o.found).map((o) => o.type);
    expect(types).toContain('ObjStm');
    expect(types).toContain('XRef');
  });

  // LO-9: 表が名指ししているのに値が null（§7.3.9）。「無い」で正しいが、
  // **表に載っていない**のとは別のことが起きている。読み手のすることが違う。
  it('LO-9: a null-valued object says so, and is not called freed', async () => {
    const path = writeSpecimen('null-valued.pdf', NULL_VALUED_OBJECT);
    const { objects } = await locateObjects(path, [3, 4]);
    const three = objects.find((o) => o.objectNumber === 3);
    const four = objects.find((o) => o.objectNumber === 4);
    expect(three?.found).toBe(true);
    expect(four?.found).toBe(false);
    expect(four?.reason).toMatch(/null object/);
    expect(four?.reason).toMatch(/7\.3\.9/);
    expect(four?.reason).not.toMatch(/freed by a later revision is expected/);
  });

  // LO-10: 空でない利用者パスワードの文書。鍵が導けないので 1 つも読めない。
  // 🔴 それを「このオブジェクトは存在しない」と言ってはいけない ——
  // 後の版が freed にしたのと同じ顔になる。次にすることが違う（パスワードを渡す）。
  it('LO-10: a document whose key cannot be derived says so, not "no such object"', async () => {
    const s = HALVES_SPECIMENS.failOk;
    const path = writeSpecimen(s.name, s.base64);
    const { objects, isEncrypted, notes } = await locateObjects(path, [1, 2, 3]);
    expect(isEncrypted).toBe(true);
    expect(objects.every((o) => o.found === false)).toBe(true);
    for (const o of objects) {
      expect(o.reason).toMatch(/7\.6\.4\.3\.2/);
      expect(o.reason).not.toMatch(/No object with this number exists/);
    }
    expect(notes.join(' ')).toMatch(/could not be derived/);
  });
});
