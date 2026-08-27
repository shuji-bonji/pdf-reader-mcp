/**
 * `engines.node` の宣言が、`package-lock.json` が固定した依存の要求を下回っていないかを検査する。
 *
 * なぜ要るか: `.npmrc` に `engine-strict` を置いていないので、`npm ci` は `EBADENGINE` を
 * **警告として出して通る**。宣言と実体の食い違いは CI では赤にならない。
 *
 * 数え方（推測を入れない）:
 *   - `optional` / `os` / `cpu` を持つものは除外する（環境別の任意依存は install されないことがある）
 *   - `||` は選択肢なので、各選択肢の先頭バージョンの**最小値**をその依存の下限とする
 *     （`^20.19.0 || >=22.12.0` の下限は 20.19.0）
 *   - 実行時依存（`dev: false`）だけを門番にする。dev 依存は CI マトリクスへの警告どまり
 *
 * 例外: `package.json` の `engineExceptions` に書く。**入口とセットで書き、
 * `entryPoints` 以外から import していたら例外を無効にする** —— 依存の宣言より低い版で
 * 動くと言えるのは、実際に測った入口についてだけだから。
 *
 * 使い方:
 *   node scripts/check-engines.mjs            門番（違反で exit 1）
 *   node scripts/check-engines.mjs --report   engines を持つ依存を全部並べる
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPORT = process.argv.includes('--report');

/** `>=20` `^20.19.0 || >=22.12.0` → [major, minor, patch]（`||` は最小の選択肢を取る） */
function floorOf(range) {
  const alts = String(range).split('||');
  let best = null;
  for (const alt of alts) {
    const m = alt.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!m) continue;
    const v = [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
    if (best === null || cmp(v, best) < 0) best = v;
  }
  return best;
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

const show = (v) => (v ? v.join('.') : '(なし)');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

const declared = pkg.engines?.node;
if (!declared) {
  console.log('✗ package.json に engines.node が無い');
  process.exit(1);
}
const declaredFloor = floorOf(declared);

/** lock から engines.node を持つ依存を集める（環境別の任意依存は除外） */
const found = { runtime: [], dev: [] };
for (const [path, v] of Object.entries(lock.packages ?? {})) {
  if (!path || !v?.engines?.node) continue;
  if (v.optional || v.os || v.cpu) continue;
  const name = path.replace(/.*node_modules\//, '');
  found[v.dev ? 'dev' : 'runtime'].push({
    name,
    version: v.version,
    range: v.engines.node,
    floor: floorOf(v.engines.node),
  });
}

/** 例外の入口検査: src が entryPoints 以外からその依存を import していないか */
function collectImports(pkgName) {
  const specs = new Set();
  const roots = ['src'].filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
  const re = new RegExp(`['"](${pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/[^'"]*)?)['"]`, 'g');
  for (const root of roots) {
    (function walk(d) {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(p)) {
          const text = readFileSync(p, 'utf8');
          for (const line of text.split('\n')) {
            if (!/\b(from|import|require)\b/.test(line)) continue;
            for (const m of line.matchAll(re)) specs.add(m[1]);
          }
        }
      }
    })(root);
  }
  return [...specs].sort();
}

const exceptions = pkg.engineExceptions ?? {};
const problems = [];
const notes = [];

for (const [name, spec] of Object.entries(exceptions)) {
  if (!spec?.reason || !spec?.measuredOn || !Array.isArray(spec?.entryPoints)) {
    problems.push(`例外 "${name}" に reason / measuredOn / entryPoints が揃っていない`);
    continue;
  }
  const actual = collectImports(name);
  const stray = actual.filter((s) => !spec.entryPoints.includes(s));
  if (stray.length) {
    problems.push(
      `例外 "${name}" は入口 ${JSON.stringify(spec.entryPoints)} について測ったもの。` +
        `src が別の入口から import している: ${JSON.stringify(stray)}`,
    );
  } else {
    notes.push(`例外 "${name}" 有効（測定日 ${spec.measuredOn}・入口 ${actual.join(', ') || '(src に import 無し)'}）`);
  }
}

/** 門番: 実行時依存の最大下限 ≦ 宣言の下限 */
let worst = null;
for (const d of found.runtime) {
  if (exceptions[d.name]) continue;
  if (!d.floor) continue;
  if (!worst || cmp(d.floor, worst.floor) > 0) worst = d;
}
if (worst && cmp(worst.floor, declaredFloor) > 0) {
  problems.push(
    `engines.node が "${declared}"（下限 ${show(declaredFloor)}）だが、` +
      `実行時依存 ${worst.name}@${worst.version} は "${worst.range}"（下限 ${show(worst.floor)}）を要求する`,
  );
}

/** 警告: dev 込みの最大下限が CI マトリクスの最小値を超えていないか（落とさない） */
let worstDev = null;
for (const d of [...found.runtime, ...found.dev]) {
  if (exceptions[d.name] || !d.floor) continue;
  if (!worstDev || cmp(d.floor, worstDev.floor) > 0) worstDev = d;
}

console.log(`${pkg.name} — engines.node: ${declared}（下限 ${show(declaredFloor)}）`);
console.log(
  `  実行時依存の最大要求: ${worst ? `${worst.range}  (${worst.name}@${worst.version})` : '(engines を持つ実行時依存なし)'}`,
);
console.log(
  `  dev 込みの最大要求  : ${worstDev ? `${worstDev.range}  (${worstDev.name}@${worstDev.version})` : '(なし)'}`,
);
for (const n of notes) console.log(`  ・${n}`);

if (REPORT) {
  console.log('\n  engines.node を宣言する依存（optional/os/cpu を除く）:');
  for (const kind of ['runtime', 'dev']) {
    for (const d of found[kind].sort((a, b) => cmp(b.floor ?? [0, 0, 0], a.floor ?? [0, 0, 0]))) {
      console.log(`    [${kind === 'runtime' ? '実行時' : 'dev   '}] ${d.name}@${d.version}  ${d.range}`);
    }
  }
}

if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`✗ ${p}`);
  process.exit(1);
}
console.log('\n✓ engines.node の宣言は依存の要求を満たしている');
