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
 * server.json（MCP Registry 用）の version も同じ置き去りが起きる。pdf-spec-mcp 0.6.2 で
 * server.json が 0.6.1 のまま残り、`mcp-publisher publish` が
 * "cannot publish duplicate version" で止まった（2026-10-13）。plugin.json と同じ
 * フックで server.json の 2 箇所（version / packages[].version）も揃える。
 *
 *   node scripts/sync-plugin-version.mjs           # 同期(書き換え)
 *   node scripts/sync-plugin-version.mjs --check   # 照合のみ。ずれていれば exit 1
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, '.claude-plugin', 'plugin.json');
const SERVER = join(ROOT, 'server.json'); // MCP Registry 用。version は 2 箇所（server と packages[].version）

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const plugin = JSON.parse(readFileSync(PLUGIN, 'utf8'));
const server = JSON.parse(readFileSync(SERVER, 'utf8'));

const serverVersions = [server.version, ...(server.packages ?? []).map((p) => p.version)];
const pluginInSync = plugin.version === pkg.version;
const serverInSync = serverVersions.every((v) => v === pkg.version);

if (pluginInSync && serverInSync) {
  console.log(`plugin.json / server.json は同期済み (${pkg.version})`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  if (!pluginInSync) {
    console.error(`plugin.json ${plugin.version} ≠ package.json ${pkg.version}`);
  }
  if (!serverInSync) {
    console.error(`server.json ${serverVersions.join(' / ')} ≠ package.json ${pkg.version}`);
  }
  console.error('node scripts/sync-plugin-version.mjs で同期してください');
  process.exit(1);
}

if (!pluginInSync) {
  plugin.version = pkg.version;
  writeFileSync(PLUGIN, `${JSON.stringify(plugin, null, 2)}\n`);
  console.log(`plugin.json: ${pkg.version} に同期しました`);
}
if (!serverInSync) {
  server.version = pkg.version;
  for (const p of server.packages ?? []) p.version = pkg.version;
  writeFileSync(SERVER, `${JSON.stringify(server, null, 2)}\n`);
  console.log(`server.json: ${pkg.version} に同期しました`);
}
