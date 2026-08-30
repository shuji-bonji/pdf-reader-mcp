#!/usr/bin/env node
/**
 * 「文字の取り出し」と「その文字が Unicode に変換できるかの観測」が
 * 別々に成功・失敗する検体を作る（family 第 3 弾 L0）。
 *
 * `read_text` は次の 2 本を `Promise.all` に入れている。
 *   1. `extractText`          —— pdfjs。ページの文字を取り出す
 *   2. `observeExtractability` —— pdf-lib。ISO 32000-2 §9.10.1 の 4 状態を観測する
 *
 * 2 本は別々に失敗しうるので、答えは 4 通りある。2,931 件のコーパスを
 * `scripts/probe-read-halves.mjs` で測ったところ、出ていたのは 3 通りだった。
 *
 * ```
 * ok/ok     2,927      ok/fail  3      fail/ok  0  ← この集合には無い     fail/fail  1
 * ```
 *
 * 🔴 **`fail/ok` を持つ検体が 1 つも無い。** その経路をどう直しても、直したことを
 * 検体で確かめられない。ここで 4 通りすべてを 1 件ずつ作る。
 *
 * 🔴 バイト列は毎回同じになる（ゴールデンの基準になるため）。
 *    暗号化した検体は qpdf に作らせるが、`--static-id` を渡して /ID を固定する。
 *    RC4 を選ぶのはそれが理由で、強度の話ではない —— AES-256（/R 6）は
 *    鍵の生成に乱数が入るので、同じ入力から同じバイト列が出ない。
 *
 * 使い方: node scripts/golden-specimens-halves.mjs [--out <dir>]
 *
 * 🔴 このスクリプトは自分が作る 4 件だけを書く。ほかの検体には触れない。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const L = (s) => Buffer.from(s, 'latin1');
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 32);

/**
 * 間接オブジェクトを 1 から連番で書き、相互参照表を `0 N` の 1 節で書く（§7.5.4）。
 * 節を 1 つにするのは family の型 —— 番号が飛ぶと節が分かれ、検体の主旨と無関係な差になる。
 */
function buildPdf(objects, header = '%PDF-1.7') {
  const chunks = [];
  let offset = 0;
  const push = (b) => {
    chunks.push(b);
    offset += b.length;
  };
  const offsets = [];
  push(L(`${header}\n%\xE2\xE3\xCF\xD3\n`));
  objects.forEach((body, i) => {
    offsets.push(offset);
    push(L(`${i + 1} 0 obj\n`));
    push(Buffer.isBuffer(body) ? body : L(body));
    push(L('\nendobj\n'));
  });
  const xrefAt = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  push(L(xref));
  push(L(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

const stream = (dict, data) => {
  const body = Buffer.isBuffer(data) ? data : L(data);
  return Buffer.concat([
    L(`<< ${dict}${dict ? ' ' : ''}/Length ${body.length} >>\nstream\n`),
    body,
    L('\nendstream'),
  ]);
};

const FONT = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
const PAGE = (contents) =>
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
  `/Resources << /Font << /F1 7 0 R >> >> /Contents ${contents} 0 R >>`;

/** 2 ページの土台。7 番がフォント、4 番と 6 番が内容ストリーム。 */
const twoPages = (obj6) => [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  PAGE(4),
  stream('', 'BT /F1 12 Tf 72 720 Td (Page one has text) Tj ET\n'),
  PAGE(6),
  obj6,
  FONT,
];

const onePage = (header) =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
        `/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
      stream('', 'BT /F1 12 Tf 72 720 Td (One page with readable text) Tj ET\n'),
      FONT,
    ],
    header,
  );

// --------------------------------------------------------------------------

const outDir = (() => {
  const i = process.argv.indexOf('--out');
  return resolve(i > 0 ? process.argv[i + 1] : join(ROOT, '.golden/specimens'));
})();
mkdirSync(outDir, { recursive: true });

/** qpdf が無ければ、暗号化した検体は作れない。黙って 3 件で済ませない。 */
let qpdfVersion = null;
try {
  qpdfVersion = String(execFileSync('qpdf', ['--version'])).split('\n')[0];
} catch {
  console.error('qpdf が無い。暗号化した検体（fail/ok の軸）が作れないので止まる。');
  console.error('  macOS: brew install qpdf / Debian: apt install qpdf');
  process.exit(2);
}

/**
 * 利用者パスワードを付けた検体を作る。
 *
 * §7.6.4.3.2「Algorithm 2」は、/R 3 のファイル暗号鍵を
 * **32 バイトに詰めた利用者パスワード + /O + /P + /ID の先頭要素**から導くと書いている。
 * 空のパスワードを入れる余地はその「詰める」の側にしかないので、空でない利用者
 * パスワードが設定された文書は、パスワードが無ければ**鍵が導けない**。
 * pdfjs はそこで PasswordException を投げ、pdf-lib は ignoreEncryption で
 * 構造だけを歩く —— これが fail/ok になる。
 */
function encryptWithQpdf(plain, name) {
  // 🔴 途中のファイルは検体の置き場に作らない（device_bash は消せない）
  const scratch = join(tmpdir(), 'pdf-reader-specimens');
  mkdirSync(scratch, { recursive: true });
  const tmpIn = join(scratch, `${name}.plain.pdf`);
  writeFileSync(tmpIn, plain);
  const tmpOut = join(scratch, `${name}.enc.pdf`);
  execFileSync('qpdf', [
    '--allow-weak-crypto',
    // 🔴 /ID を固定する。/ID は鍵の材料（Algorithm 2 の e）なので、
    // ここが毎回変わると同じ入力から違うバイト列が出る
    '--static-id',
    '--encrypt', 'reader-mcp-user', 'reader-mcp-owner', '128', '--use-aes=n', '--',
    tmpIn,
    tmpOut,
  ]);
  return readFileSync(tmpOut);
}

const specimens = [
  {
    name: 'halves-ok-ok-page2-unobserved.pdf',
    axes: ['halves:ok/ok', 'per-page-differs', 'content-stream-undecodable'],
    note: '2 ページ目の内容ストリームが /FlateDecode を名乗って deflate ではない。' +
      '抽出は 1 ページ目の文字を返し、観測は 2 ページ目を not_observed と言う',
    build: () =>
      buildPdf(twoPages(stream('/Filter /FlateDecode', Buffer.from('not-deflate-data-at-all')))),
  },
  {
    name: 'halves-ok-fail-header.pdf',
    axes: ['halves:ok/fail', 'header-damaged'],
    note: 'ヘッダが "%PDF-" で版が無い（§7.5.2）。pdfjs は読み進めるが、' +
      'pdf-lib は版の数を読もうとして止まる。抽出だけが答えを返す',
    build: () => onePage('%PDF-'),
  },
  {
    name: 'halves-fail-ok-password.pdf',
    axes: ['halves:fail/ok', 'encrypted', 'user-password-set', 'key-underivable'],
    note: '空でない利用者パスワードが設定されている（/V 2 /R 3・RC4 128）。' +
      '§7.6.4.3.2 のとおり鍵が導けないので pdfjs は開けない。' +
      'pdf-lib は ignoreEncryption で構造を歩き、全ページを not_observed と言う',
    password: 'reader-mcp-user',
    build: () => encryptWithQpdf(onePage(), 'halves-fail-ok-password'),
  },
  {
    name: 'halves-fail-fail-no-objects.pdf',
    axes: ['halves:fail/fail'],
    note: '%PDF- が無く、間接オブジェクトも 1 つも無い。どちらの読み手も開けない。' +
      '2 つの理由が両方とも出ることを確かめるための検体。' +
      '🔴 ヘッダを壊しただけでは fail/fail にならない —— pdfjs は本体から組み直すので、' +
      'ヘッダが "%!Not-A-PDF-At-All" でも 27 字を返した（実測）',
    build: () =>
      Buffer.from(
        '%!Not-A-PDF-At-All\n' +
          'This file has no PDF header and no indirect objects.\n' +
          'There is nothing here for either reader to reconstruct.\n',
        'latin1',
      ),
  },
];

const manifestPath = join(outDir, 'manifest.json');
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { specimens: [] };
const bySpecimen = new Map((manifest.specimens ?? []).map((s) => [s.name, s]));

console.log(`検体を書く -> ${outDir}`);
console.log(`  qpdf: ${qpdfVersion}`);
for (const s of specimens) {
  const a = s.build();
  // 🔴 2 回作って同じバイト列になることを、書く前に見る。
  // 基準に使う検体が実行ごとに変わっては、差の帰属が成り立たない
  const b = s.build();
  if (!a.equals(b)) {
    console.error(`🔴 ${s.name}: 2 回作ったら別のバイト列になった。基準に使えない`);
    process.exit(2);
  }
  const p = join(outDir, s.name);
  const before = existsSync(p) ? sha(readFileSync(p)) : null;
  writeFileSync(p, a);
  const now = sha(a);
  console.log(
    `  ${s.name.padEnd(38)} ${String(a.length).padStart(6)} バイト  ${now}` +
      (before && before !== now ? '  🔴 前と違うバイト列になった' : before ? '  （前と同じ）' : '  （新規）'),
  );
  bySpecimen.set(s.name, {
    name: s.name,
    axes: s.axes,
    note: s.note,
    sha256: now,
    ...(s.password ? { password: s.password } : {}),
    generatedBy: 'scripts/golden-specimens-halves.mjs',
    qpdf: s.password ? qpdfVersion : undefined,
  });
}

// 🔴 このスクリプトが前に作って、いまは作らなくなった検体を manifest に残さない。
// ファイルそのものは消せない環境があるので、名指しして手で退けてもらう。
const mine = new Set(specimens.map((s) => s.name));
for (const [name, entry] of [...bySpecimen]) {
  if (entry.generatedBy === 'scripts/golden-specimens-halves.mjs' && !mine.has(name)) {
    bySpecimen.delete(name);
    console.log(`  🔴 いまは作らない検体が置き場に残っている: ${name}`);
    console.log('     manifest からは外した。ファイルは手で退けること（置いたままだと基準に混ざる）');
  }
}

manifest.specimens = [...bySpecimen.values()].sort((x, y) => x.name.localeCompare(y.name));
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`  manifest.json に ${manifest.specimens.length} 件`);
