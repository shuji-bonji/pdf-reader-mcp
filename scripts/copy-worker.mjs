#!/usr/bin/env node
/**
 * Worker の実体を dist へ複製する。
 *
 * `src/services/page-renderer.worker.mjs` は TypeScript ではないので `tsc` は
 * 触らない。TypeScript で書けない理由は、Node が**そのまま**実行するからである
 * —— Node 20 には型剥がしが無く、Node 22 でも版によっては既定で有効ではないため、
 * `.ts` の worker は `Unknown file extension ".ts"` で落ちる（CI で実際に落ちた）。
 *
 * 🔴 これを忘れると、公開物の render_page が worker を見つけられない。
 * `npm run build` の一部として必ず走らせる。
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKERS = ['services/page-renderer.worker.mjs'];

let copied = 0;
for (const relative of WORKERS) {
  const from = join(ROOT, 'src', relative);
  const to = join(ROOT, 'dist', relative);
  if (!existsSync(from)) {
    console.error(`copy-worker: 元が無い: src/${relative}`);
    process.exit(1);
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied++;
}
console.log(`copy-worker: ${copied} 件を dist へ複製した`);
