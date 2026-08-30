#!/usr/bin/env node
/**
 * read_text が並行に投げている 2 本を、**別々に**回して結果を数える。
 *
 * `src/tools/tier1/read-text.ts` は次の 2 本を `Promise.all` に入れている。
 *   1. `extractText(filePath, pages)`          —— pdfjs。ページの文字を取り出す
 *   2. `observeExtractability(filePath, pages)` —— pdf-lib。その文字が Unicode に
 *                                                 変換できるか（ISO 32000-2 §9.10.1）を見る
 *
 * `Promise.all` は**先に失敗したほうの理由で拒否する**ので、
 *   - どちらが失敗したのかが出力に残らない
 *   - 片方が成功していても、その結果ごと捨てられる
 *   - どちらが先に失敗するかは実行ごとに変わる（実測: 12 回中 2 回で別のコードが出た）
 *
 * この probe が数えるのは **4 通りの組み合わせ**である。
 *   ok/ok     どちらも読めた
 *   ok/fail   文字は取れたが、Unicode に変換できるかを見られなかった
 *   fail/ok   文字は取れなかったが、フォントの申告は読めた
 *   fail/fail どちらも読めない
 * 🔴 ok/fail と fail/ok の件数が、いまの形が**捨てている観測**の件数である。
 *
 * 使い方:
 *   node scripts/probe-read-halves.mjs [--set <dir>]... [--limit N] [--max-bytes N]
 *
 * 🔴 数を出す前に --self-check を通す。当たる入力で当たらない probe は 0 件を報告する。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

console.log = (...a) => console.error('[log]', ...a);
console.warn = (...a) => console.error('[warn]', ...a);
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

const DEFAULT_SETS = [
  join(ROOT, 'tests/fixtures'),
  resolve(ROOT, '../../lib/normativepdf/corpus/veraPDF-corpus'),
  resolve(ROOT, '../../lib/normativepdf/corpus/pdf20examples'),
  resolve(ROOT, '../../lib/normativepdf/corpus/_wout'),
];

function listPdfs(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const opts = { sets: [], limit: 0, maxBytes: 3_000_000 };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--set') opts.sets.push(process.argv[++i]);
  else if (a === '--limit') opts.limit = Number(process.argv[++i]);
  else if (a === '--max-bytes') opts.maxBytes = Number(process.argv[++i]);
  else {
    console.error(`知らない引数: ${a}`);
    process.exit(2);
  }
}

const { extractText } = await import('../dist/services/pdfjs-service.js');
const { observeExtractability } = await import('../dist/services/text-extractability-service.js');

/** 片方を回して、成功なら中身、失敗なら code と本文を返す。例外は握りつぶさない。 */
async function run(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, code: e?.code ?? e?.constructor?.name ?? 'Error', message: String(e?.message ?? e).slice(0, 120) };
  }
}

// 🔴 自己検査 —— 当たる入力で当たることを先に見る
const okFixture = join(ROOT, 'tests/fixtures/tagged.pdf');
const badFixture = join(ROOT, 'tests/fixtures/corrupted.pdf');
for (const p of [okFixture, badFixture]) {
  if (!existsSync(p)) {
    say(`🔴 自己検査の検体が無い: ${p}（npm run test:fixtures）`);
    process.exit(2);
  }
}
{
  const a = await run(() => extractText(okFixture));
  const b = await run(() => observeExtractability(okFixture));
  const c = await run(() => extractText(badFixture));
  const d = await run(() => observeExtractability(badFixture));
  const pass = a.ok && b.ok && !c.ok && !d.ok;
  say(`自己検査: 読める検体 = ${a.ok ? 'ok' : 'fail'}/${b.ok ? 'ok' : 'fail'}  ` +
    `壊れた検体 = ${c.ok ? 'ok' : 'fail'}/${d.ok ? 'ok' : 'fail'}  -> ${pass ? '通った' : '🔴 通らない'}`);
  if (!pass) {
    say('  この probe は当たる入力で当たっていない。数を出さずに止まる。');
    process.exit(2);
  }
}

const sets = (opts.sets.length ? opts.sets : DEFAULT_SETS).map((d) => resolve(d));
const targets = [];
for (const d of sets) {
  const token = basename(d) === 'veraPDF-corpus' ? 'veraPDF' : basename(d);
  for (const p of listPdfs(d)) targets.push({ key: `{${token}}/${relative(d, p)}`, path: p });
}
targets.sort((a, b) => a.key.localeCompare(b.key));
const picked = (opts.limit ? targets.slice(0, opts.limit) : targets)
  .filter((t) => statSync(t.path).size <= opts.maxBytes);

const counts = { 'ok/ok': 0, 'ok/fail': 0, 'fail/ok': 0, 'fail/fail': 0 };
const okFail = [];
const failOk = [];
const codePairs = new Map();
const t0 = Date.now();

for (const t of picked) {
  const a = await run(() => extractText(t.path));
  const b = await run(() => observeExtractability(t.path));
  const k = `${a.ok ? 'ok' : 'fail'}/${b.ok ? 'ok' : 'fail'}`;
  counts[k]++;
  if (k === 'ok/fail') okFail.push(`${t.key}  文字 ${a.value.reduce((s, p) => s + (p.text?.length ?? 0), 0)} 字を取れていた / 観測は ${b.code}: ${b.message}`);
  if (k === 'fail/ok') failOk.push(`${t.key}  抽出は ${a.code}: ${a.message} / 観測は ${b.value.length} ページ分読めていた`);
  if (k === 'fail/fail') {
    const pair = `${a.code} <-> ${b.code}`;
    codePairs.set(pair, (codePairs.get(pair) ?? 0) + 1);
  }
}

say(`\n検体 ${picked.length} 件（${opts.maxBytes} バイトを超えるものは外した）/ ${Date.now() - t0}ms`);
say('\n  抽出 / 観測 の組み合わせ:');
for (const [k, v] of Object.entries(counts)) say(`    ${k.padEnd(10)} ${String(v).padStart(5)}`);
const thrown = counts['ok/fail'] + counts['fail/ok'];
say(`\n  🔴 いまの Promise.all が捨てている観測: ${thrown} 件（ok/fail と fail/ok）`);
say(`  🔴 どちらの理由が出るかが実行ごとに決まる検体: ${counts['fail/fail']} 件`);

if (counts['fail/fail']) {
  say('\n  どちらも失敗したときの、2 つの理由の組み合わせ:');
  for (const [k, v] of [...codePairs].sort((a, b) => b[1] - a[1])) {
    say(`    ${k.padEnd(46)} ${v}`);
  }
}
for (const [name, list] of [['ok/fail', okFail], ['fail/ok', failOk]]) {
  if (!list.length) continue;
  say(`\n  ${name}（${list.length} 件）:`);
  for (const l of list.slice(0, 15)) say(`    ${l}`);
  if (list.length > 15) say(`    … 残り ${list.length - 15} 件`);
}
