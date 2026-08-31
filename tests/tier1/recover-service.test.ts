/**
 * 17 - `detectEncryption` を pdf-lib から `@normativepdf/recover` へ移した（L1）
 *
 * `detectEncryption` は `metadata.isEncrypted` の唯一の供給元で、そこから
 * `summarize` を経て pdf-read Phase 1 の停止条件になる。**壊れても何も落ちない**
 * 経路なので（条件が false になるだけ）、ここで直接固定する。
 * 0.14.0 まで、この関数には試験が 1 件も無かった。
 *
 * 🔴 ここが守っているのは振る舞いであって、実装ではない。
 * 読めなかったときに `false` を返すのは pdf-lib 版から引き継いだもので、
 * 「暗号化されていない」ではなく「見に行けなかった」である。
 * この区別を付ける（`PartOutcome` にする）のは A/B を採ったあとの別の段で、
 * そのときこの試験の最後の 1 件が落ちる —— それが合図になる。
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectEncryption } from '../../src/services/recover-service.js';
import { HALVES_SPECIMENS } from '../e2e/halves-specimens.js';

const dir = mkdtempSync(join(tmpdir(), 'recover-service-'));

function write(name: string, bytes: Uint8Array | Buffer): string {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}

function specimen(key: keyof typeof HALVES_SPECIMENS): string {
  const s = HALVES_SPECIMENS[key];
  return write(s.name, Buffer.from(s.base64, 'base64'));
}

describe('17 - detectEncryption（recover 版）', () => {
  it('L1-1: /Encrypt のある文書を true と言う', async () => {
    // failOk = 空でない利用者パスワード付き（§7.6.4.3.2 で鍵が導けない）。
    // 🔴 鍵が導けなくても /Encrypt の有無は読める（§7.6.2 が暗号化の対象から外している）。
    expect(await detectEncryption(specimen('failOk'))).toBe(true);
  });

  it('L1-2: /Encrypt の無い文書を false と言う', async () => {
    expect(await detectEncryption(specimen('okOk'))).toBe(false);
  });

  it('L1-3: 版の無いヘッダでも、読めた範囲で答える', async () => {
    // okFail = ヘッダが "%PDF-" で版が無い（§7.5.2）。pdf-lib はここで止まっていた。
    expect(await detectEncryption(specimen('okFail'))).toBe(false);
  });

  it('L1-4: 🔴 開けなかった文書も false を返す（pdf-lib 版から引き継いだ握り潰し）', async () => {
    // failFail = %PDF- も間接オブジェクトも無い。「暗号化されていない」ではなく
    // 「見に行けなかった」なのに、L1-2 と同じ値を返す。次の段でここを分ける。
    expect(await detectEncryption(specimen('failFail'))).toBe(false);
    expect(await detectEncryption(write('empty.pdf', Buffer.alloc(0)))).toBe(false);
  });

  it('L1-5: 存在しないパスでも投げない', async () => {
    expect(await detectEncryption(join(dir, 'no-such-file.pdf'))).toBe(false);
  });
});
