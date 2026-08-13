#!/usr/bin/env node
/**
 * plugin.json の version を package.json に同期する。
 *
 * この repo ではまだ置き去りは起きていないが、同じ構造を持つ family の他 3 つでは
 * 起きている — pdf-verify-mcp で 2 度 (0.11.0→0.14.0 の 8452b4f / 0.14.0→0.14.2 の
 * 5232b20)、pdf-writer-mcp で 1 度 (0.17.0 のまま 0.18.0 を公開)。いずれも tag の
 * 後の追いコミットで直しており、**tag が指す木には間違った plugin.json が入ったまま**
 * である。plugin は tag から取られるので、これは公開物の欠陥になる。
 *
 * `npm version` の version フックから呼ばれることで、リリースコミット = tag の木に
 * 正しい plugin.json が入る。予防的な移植であって、事故の後追いではない。
 *
 *   node scripts/sync-plugin-version.mjs           # 同期(書き換え)
 *   node scripts/sync-plugin-version.mjs --check   # 照合のみ。ずれていれば exit 1
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, '.claude-plugin', 'plugin.json');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const plugin = JSON.parse(readFileSync(PLUGIN, 'utf8'));

if (plugin.version === pkg.version) {
  console.log(`plugin.json は同期済み (${pkg.version})`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  console.error(
    `plugin.json ${plugin.version} ≠ package.json ${pkg.version} — node scripts/sync-plugin-version.mjs で同期してください`,
  );
  process.exit(1);
}

plugin.version = pkg.version;
writeFileSync(PLUGIN, `${JSON.stringify(plugin, null, 2)}\n`);
console.log(`plugin.json: ${plugin.version} に同期しました`);
