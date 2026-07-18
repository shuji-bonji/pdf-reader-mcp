/**
 * Tests for validation-service.ts
 */

import { describe, expect, it } from 'vitest';
import { isValidPdfDate } from '../../src/services/validation-service.js';

// D-3 regression: the PDF date pattern had two bugs, both confirmed against
// real input (see docs/spec-conformance-review-2026-07-17.md Medium-1).
//
//   1. `[+-Z]` is a character RANGE (U+002B '+' … U+005A 'Z'), not the three
//      characters intended. It accepted `,-./0-9:;<=>?@A-Z` as timezone markers.
//   2. `(\d{2}'\d{2}'?)?` welded the offset's HH and mm together, rejecting the
//      valid `D:...-09'`.
//
// The old pattern also ignored every value range, so month 13 was a valid date.
describe('isValidPdfDate', () => {
  // ISO 32000-2 §7.9.4: (D:YYYYMMDDHHmmSSOHH'mm)
  describe('accepts valid PDF dates', () => {
    const valid: [string, string][] = [
      ["D:20241231235959+09'00", 'PDF 2.0 の完全形'],
      ["D:199812231952-08'00", '条文の EXAMPLE (SS 省略。§7.9.4 の EXAMPLE そのもの)'],
      ["D:20241231235959-09'", 'mm 省略 (APOSTROPHE があれば mm は任意)'],
      ["D:20241231235959+09'00'", 'PDF 1.7 形式の末尾 APOSTROPHE (NOTE 2 が受理を推奨)'],
      ['D:20241231235959Z', 'Z のみ'],
      ["D:20241231235959Z00'00", 'NOTE 3: Z にオフセットが付く形'],
      ['D:2024', 'YYYY のみ (YYYY 以外は省略可)'],
      ['D:202412', 'YYYYMM'],
      ['D:20241231', 'YYYYMMDD'],
      ['D:20241231235959', 'オフセットなし'],
      ['D:20260718002944Z', 'tests/fixtures/simple.pdf が実際に持つ値'],
    ];
    for (const [input, why] of valid) {
      it(`${input} — ${why}`, () => {
        expect(isValidPdfDate(input)).toBe(true);
      });
    }
  });

  // バグ1: [+-Z] が範囲だったため、これらは全て「有効な日付」として通っていた
  describe('rejects invalid timezone markers (the [+-Z] range bug)', () => {
    const invalid: [string, string][] = [
      ["D:20241231235959A09'00", 'O=A。§7.9.4 は + / - / Z のみを許す'],
      ['D:202412312359595', 'O=数字'],
      ["D:20241231235959,09'00", "','  は範囲 +…Z の内側だった"],
      ["D:20241231235959@09'00", "'@' は範囲 +…Z の内側だった"],
      ["D:20241231235959:09'00", "':' は範囲 +…Z の内側だった"],
    ];
    for (const [input, why] of invalid) {
      it(`${input} — ${why}`, () => {
        expect(isValidPdfDate(input)).toBe(false);
      });
    }
  });

  // 値域。旧実装は \d{2} で素通ししていた
  describe('rejects out-of-range field values', () => {
    const invalid: [string, string][] = [
      ['D:20241331235959', '月13 (MM shall be the month (01–12))'],
      ['D:20240031235959', '月00'],
      ['D:20241200235959', '日00 (DD shall be the day (01–31))'],
      ['D:20241232235959', '日32'],
      ['D:20241231245959', '時24 (HH shall be the hour (00–23))'],
      ['D:20241231236059', '分60 (mm shall be the minute (00–59))'],
      ['D:20241231235960', '秒60 (SS shall be the second (00–59))'],
      ["D:20241231235959+24'00", 'オフセット時24 (offset HH は 00–23)'],
      ["D:20241231235959+09'60", 'オフセット分60 (offset mm は 00–59)'],
    ];
    for (const [input, why] of invalid) {
      it(`${input} — ${why}`, () => {
        expect(isValidPdfDate(input)).toBe(false);
      });
    }
  });

  // 「preceding fields が全て存在する場合のみ後続を置ける」
  describe('rejects malformed structures', () => {
    const invalid: [string, string][] = [
      ['20241231235959', "'D:' 前置がない"],
      ['D:2024123', '半端な桁数'],
      ["D:19981223-08'00", '時刻なしでオフセットだけ付く'],
      ["D:2024123119-08'00", 'mm なしでオフセットが付く'],
      ['D:', 'YYYY がない'],
      ['', '空文字列'],
    ];
    for (const [input, why] of invalid) {
      it(`${JSON.stringify(input)} — ${why}`, () => {
        expect(isValidPdfDate(input)).toBe(false);
      });
    }
  });

  // §7.9.4 の形式ではないが、非準拠プロデューサ向けの寛容として受理し続ける
  describe('tolerates ISO 8601 (not §7.9.4 conformance)', () => {
    for (const input of ['2024-12-31', '2024-12-31T23:59', '2024-12-31T23:59:59Z']) {
      it(`${input}`, () => {
        expect(isValidPdfDate(input)).toBe(true);
      });
    }
  });
});
