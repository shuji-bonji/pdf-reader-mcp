#!/usr/bin/env node
/**
 * 描画が終わらないページを持つ検体（#27）。
 *
 * veraPDF コーパスの `TWG test suite A018-pdfa2-pass-b.pdf`（3,461 バイト）と
 * `...-fail-b.pdf` は、`render_page` が返らない。20 分待っても終わらず、
 * プロセスごと落とすしかなかった。検体自身が理由を書いている。
 *
 * ```
 * /Title (expected message: Colored Pattern contains entry /YStep operator
 *         with value -1.175e-38)
 * ```
 *
 * ISO 32000-2 §8.7.3.1 の Table 74 は、タイリングパターンの `XStep` / `YStep` に
 * ついて「正でも負でもよいが、**0 であってはならない**」と書いている。
 * -1.175e-38 は 0 ではないので条文には反しない。ただし 1.175e-38 は float32 で
 * 表せる最小の大きさで、その間隔で 500 ポイントを敷き詰めると 10^38 枚を超える
 * タイルになる。ラスタライザは条文どおりに敷こうとして戻ってこない。
 *
 * ここで作るのはコーパスの写しではなく、**同じ形を最小限で組んだもの**である。
 * 1 ページ目は普通に描け、2 ページ目だけが終わらない —— 途中まで描けたものを
 * 返すかどうかを測るには、その 2 つが 1 つのファイルに要る。
 *
 * 使い方: node scripts/golden-specimens-render.mjs [--out <dir>]
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const L = (s) => Buffer.from(s, 'latin1');
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 32);

/** 間接オブジェクトを 1 から連番で書き、相互参照表を `0 N` の 1 節で書く（§7.5.4）。 */
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

const specimens = [
  {
    name: 'render-page2-never-finishes.pdf',
    axes: ['render:page-does-not-finish', 'tiling-pattern', 'ystep-smallest-float'],
    note:
      '3 ページの文書。1 ページ目は普通に描ける。2 ページ目はタイリングパターン' +
      '（§8.7.3.1）で塗られており、その /YStep が -1.175e-38 —— float32 で表せる' +
      '最小の大きさ。条文の「0 であってはならない」には反しないが、敷き詰めが終わらない。' +
      '3 ページ目は普通に描けるが、2 ページ目で止まるので**始まらない** —— ' +
      '「描けなかった」と「始めなかった」を分けて申告できるかを測る',
    build: () =>
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 5 0 R 9 0 R] /Count 3 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 500] ' +
          '/Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
        stream('', 'BT /F1 12 Tf 40 440 Td (Page one renders normally) Tj ET\n'),
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 500] ' +
          '/Resources << /Pattern << /P1 8 0 R >> >> /Contents 6 0 R >>',
        stream('', '/Pattern cs /P1 scn 0 0 500 500 re f\n'),
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        stream(
          '/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 ' +
            '/BBox [0 0 10 10] /XStep 10 /YStep -1.175e-38 /Resources << >>',
          '0 0 0 rg 0 0 5 5 re f\n',
        ),
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 500] ' +
          '/Resources << /Font << /F1 7 0 R >> >> /Contents 10 0 R >>',
        stream('', 'BT /F1 12 Tf 40 440 Td (Page three would render too) Tj ET\n'),
      ]),
  },
];

const outDir = (() => {
  const i = process.argv.indexOf('--out');
  return resolve(i > 0 ? process.argv[i + 1] : join(ROOT, '.golden/specimens'));
})();
mkdirSync(outDir, { recursive: true });

const manifestPath = join(outDir, 'manifest.json');
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { specimens: [] };
const bySpecimen = new Map((manifest.specimens ?? []).map((s) => [s.name, s]));

console.log(`検体を書く -> ${outDir}`);
for (const s of specimens) {
  const a = s.build();
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
      (before && before !== now ? '  🔴 前と違うバイト列' : before ? '  （前と同じ）' : '  （新規）'),
  );
  bySpecimen.set(s.name, {
    name: s.name,
    axes: s.axes,
    note: s.note,
    sha256: now,
    generatedBy: 'scripts/golden-specimens-render.mjs',
  });
}

manifest.specimens = [...bySpecimen.values()].sort((x, y) => x.name.localeCompare(y.name));
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`  manifest.json に ${manifest.specimens.length} 件`);
