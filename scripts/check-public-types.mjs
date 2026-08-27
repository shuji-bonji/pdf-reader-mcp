#!/usr/bin/env node
/**
 * 公開する型に MCP SDK / zod が現れていないことを確かめる。
 *
 * なぜ見張るか:
 *   この 4 サーバは bin 付きの npm 公開物だが、実質は bin 専用で、
 *   公開する型（dist/index.d.ts）は数行しかなく SDK / zod の型を 1 つも持たない
 *   （2026-08-27 実測）。だから peerDependencies を宣言していない。
 *
 *   公開する型に SDK / zod が現れた時点で、利用者は自分のプロジェクトで
 *   同じ SDK / zod の版を使う必要が出る（版が 2 つになると型が合わない）。
 *   そのときは peerDependencies の宣言が要る。この検査はその境目を見張る。
 *
 * 何を見るか:
 *   package.json の main / exports が指す JS に対応する .d.ts を読み、
 *   @modelcontextprotocol と zod への参照が 1 つでもあれば 1 を返す。
 *   bin は含めない（実行されるだけで、型は利用者に届かない）。
 *
 * 使い方: npm run build のあとに node scripts/check-public-types.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/** main / exports から、利用者が import しうる JS の入口を集める。 */
function entryPoints() {
  const out = new Set();
  if (typeof pkg.main === 'string') out.add(pkg.main);
  const walk = (v) => {
    if (typeof v === 'string') out.add(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(pkg.exports);
  return [...out].filter((p) => p.endsWith('.js'));
}

const FORBIDDEN = [
  { name: '@modelcontextprotocol', re: /@modelcontextprotocol\// },
  { name: 'zod', re: /from ['"]zod['"]|from ['"]zod\//},
];

let entries = entryPoints();
if (entries.length === 0) {
  // main も exports も無い場合、利用者は dist/*.js を直接 import できる。
  // 少なくとも dist/index.d.ts は見る（issue-draft-08「A3 の完了条件」の文言）。
  entries = ['dist/index.js'];
  console.log('check-public-types: main / exports が無いので dist/index.d.ts を見る。');
}

let failed = false;
let checked = 0;
for (const js of entries) {
  const dts = resolve(root, js.replace(/\.js$/, '.d.ts'));
  if (!existsSync(dts)) {
    console.error(`check-public-types: ${js} に対応する .d.ts が無い（先に npm run build）`);
    failed = true;
    continue;
  }
  checked += 1;
  const text = readFileSync(dts, 'utf8');
  for (const { name, re } of FORBIDDEN) {
    if (re.test(text)) {
      console.error(
        `check-public-types: ${js.replace(/\.js$/, '.d.ts')} が ${name} の型を公開している。\n` +
          `  利用者は自分のプロジェクトで同じ ${name} の版を使う必要が出るので、\n` +
          `  package.json に peerDependencies を宣言すること（issue-draft-08「A3 の完了条件」）。`,
      );
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`check-public-types: 公開する型 ${checked} 件に SDK / zod は現れていない。`);
