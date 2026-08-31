/**
 * 2 本の読みが別々に成功・失敗する 4 通り（#26）を、検体を挟まずに固定する。
 *
 * `tests/e2e/15-reading-scope.test.ts` は同じ規約を**実ファイル**で測っている。
 * ただし 2026-08-31 の S3（pdf-lib 撤去）以降、混ざった 2 通り
 * —— ok/fail と fail/ok —— を出す検体が 1 つも無い。
 *
 * 理由は 1 つで、観測側の読み手が `@normativepdf/recover` に変わったことである。
 * pdf-lib は「版の数が無いヘッダ」で止まり、暗号化文書を `ignoreEncryption` で
 * 構造だけ歩いた。recover はその 2 つの中間の振る舞いを持たない ——
 * 読めるか（pdfjs も読める）、鍵が導けないか（pdfjs も開けない）のどちらかになる。
 * 実測: ヘッダ無し・`/Count` 不一致・版の無いヘッダの 3 通りを作ったが、
 * 3 つとも両方の半分が成功した。
 *
 * 🔴 **検体が無いことは、規約が要らなくなったことではない。** 混ざった 2 通りは
 * `Promise.all` に戻した瞬間に壊れる経路であり、ここで止め金を掛けておく。
 */

import { describe, expect, it } from 'vitest';
import { bothFailedError, bothHalves } from '../../src/services/reading-scope.js';

const ok =
  <T>(value: T) =>
  async () =>
    value;
const boom = (message: string) => async (): Promise<never> => {
  throw new Error(message);
};

describe('bothHalves', () => {
  it('ok/ok: 2 つとも read で、2 つとも値が返る', async () => {
    const { text, observation, scope } = await bothHalves(ok('pages'), ok([1, 2]));
    expect(scope.textExtraction.status).toBe('read');
    expect(scope.extractabilityObservation.status).toBe('read');
    expect(text.value).toBe('pages');
    expect(observation.value).toEqual([1, 2]);
  });

  // 🔴 これが `Promise.all` では失われていた側。取り出せた文字を捨てない。
  it('ok/fail: 観測が失敗しても、取り出せた文字は返る', async () => {
    const { text, observation, scope } = await bothHalves(
      ok('pages'),
      boom('the page tree could not be reached from the catalogue (§7.7.3)'),
    );
    expect(text.ok).toBe(true);
    expect(text.value).toBe('pages');
    expect(observation.ok).toBe(false);
    expect(scope.textExtraction.status).toBe('read');
    expect(scope.extractabilityObservation).toMatchObject({
      status: 'failed',
      // 条文に反するファイルは INVALID_PDF。INTERNAL_ERROR は
      // 「この server が落ちた」を意味するので、そちらに倒さない。
      code: 'INVALID_PDF',
    });
  });

  it('fail/ok: 文字が取り出せなくても、観測の答えは返る', async () => {
    const { text, observation, scope } = await bothHalves(
      boom('encrypted PDF: password required (§7.6.4.3.2)'),
      ok([{ page: 1 }]),
    );
    expect(text.ok).toBe(false);
    expect(observation.value).toEqual([{ page: 1 }]);
    expect(scope.textExtraction).toMatchObject({ status: 'failed', code: 'ENCRYPTED_PDF' });
    expect(scope.extractabilityObservation.status).toBe('read');
  });

  it('fail/fail: 2 つの理由が両方とも残る', async () => {
    const { text, observation } = await bothHalves(
      boom('encrypted PDF: password required (§7.6.4.3.2)'),
      boom('the page tree could not be reached from the catalogue (§7.7.3)'),
    );
    if (text.ok || observation.ok) throw new Error('both halves were expected to fail');
    const error = bothFailedError(text.error, observation.error);
    // 最上位のコードは利用者が頼んだ側（文字の取り出し）のもので固定する。
    expect(error.code).toBe('ENCRYPTED_PDF');
    expect(error.detail?.cause).toContain('text extraction: ENCRYPTED_PDF');
    expect(error.detail?.cause).toContain('extractability observation: INVALID_PDF');
  });

  // どちらが先に片付くかで答えが変わらない。`Promise.all` はここで揺れていた。
  it('同じ入力に何度投げても同じコードが返る', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const { text, observation } = await bothHalves(
        boom('encrypted PDF: password required (§7.6.4.3.2)'),
        boom('no %PDF- header found (§7.5.2) (at byte 0)'),
      );
      if (text.ok || observation.ok) throw new Error('both halves were expected to fail');
      codes.add(bothFailedError(text.error, observation.error).code);
    }
    expect([...codes]).toEqual(['ENCRYPTED_PDF']);
  });
});
