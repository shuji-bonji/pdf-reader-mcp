#!/usr/bin/env node
/**
 * 19 ツールの出力のゴールデンを採り、2 つを突き合わせる
 * （family 第 3 弾 = pdf-reader-mcp の pdf-lib 撤去の L0）。
 *
 * **なぜ撤去前にしか採れないか**: 撤去後に採り直すと、同じ読み口同士の比較になる。
 * pdf-lib で採ったこのゴールデン自体が「第 2 の独立した読み手」を兼ねる
 * （docs/handoff/pdflib-removal.md §6 面 3）。**撤去後に作り直さないこと。**
 *
 * **どこで測るか**: 登録済みツールを InMemoryTransport 越しに呼ぶ。サービス層を直接
 * 呼ぶと `handleStructuredError` と `isError` の経路が写らない。
 * 🔴 reader の `src/index.ts` は `buildServer()` を持たず、読み込んだ時点で stdio に
 * 繋いでしまう。そこでこの計器は `registerAllTools` を自分で呼んで組む。
 * **登録されたツール名が下の CALLS の一覧と食い違ったら止まる** —— 組み方が
 * `index.ts` からずれたとき、別のものを測っていることに気づけるようにするため。
 *
 * 何を凍結するか — ツール出力の中身をそのまま持つ。要約しない:
 *   ファイル × 呼び出しごとに `raw`（JSON をそのまま）と `kept`（判定に効く項目を
 *   平らにしたもの）、それに `raw` 全体の sha。kept に無い変化も sha で出る。
 *   読めなかったファイルは落とさず `isError: true` として記録する。
 *
 * 🔴 **1 ツール = 1 呼び出しではない。** 固定した引数は測られていない経路になるので
 * （family の型）、既定以外の値を通る呼び出しを別の鍵で足してある:
 *   `read_text#cols2-compact` / `search_text#hit` / `search_text#miss` /
 *   `extract_structured_text#bbox` / `compare_structure#self` / `compare_structure#ref`
 *
 * 🔴 **本文が JSON でない呼び出しが 2 つある。** `read_images` と `render_page` は
 * `response_format` を受け取らず、常に人が読む本文を返す。これを「JSON にならない =
 * 何も測っていない」と数えると誤報になるので、`body: 'text'` として別に扱う。
 *
 * **画像の凍結の仕方**: 画像は MCP の image ブロックで返る。base64 をそのまま
 * 持つとゴールデンが肥大するので、**枚数・mimeType・バイト数・sha** だけを持つ。
 * 中身が 1 バイトでも変われば sha で出る。
 *
 * **read_url**: この 1 本だけが `file_path` ではなく URL を受け取る。take が
 * 127.0.0.1 に検体を配る http サーバを立て、そこへ向ける。外の網には触れない。
 *
 * **どちらの出力を凍結するか**: 多くのツールは `response_format` で 2 通りの本文を返す。
 *   `--format json`（既定）= 構造化された JSON。判定と対象の数はここで測る。
 *   `--format markdown`    = 利用者が既定で受け取る本文。
 * 🔴 **2 つは別のゴールデンである。** 形式の違うゴールデン同士は diff が拒む。
 *
 * 使い方:
 *   node scripts/golden.mjs take <out.json> [--set <dir>]... [--label NAME] [--limit N]
 *                                           [--resume] [--budget-ms N] [--ref <pdf>]
 *                                           [--format json|markdown]
 *   node scripts/golden.mjs diff <before.json> <after.json> [--detail <file-key>] [--max N]
 *   node scripts/golden.mjs report <golden.json>
 *   node scripts/golden.mjs t3   [golden.json]
 *
 * 🔴 `--set` は 1 つずつ直接書く（1 引数にまとめると既定の集合が黙って使われる）。
 * 🔴 take は device_bash の**前景**で回す。背景に逃がすと殺され、途中まで書けた
 *    JSON が残る。`--budget-ms` で刻み、`--resume` で継ぐ。
 *
 * 終了コード: 0 = 差なし / 1 = 差あり / 2 = 使い方の誤り・自己検査に失敗
 */

// 🔴 pdfjs-dist の warn() は console.log（= stdout）に出る。この計器は console.log を
// 報告に使うので、ツールを呼んでいる間だけ stderr に逃がす（take の中で入れ替える）。

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/**
 * 既定の検体集合。verify の B2 と同じ 3 コーパス + reader 自身の fixtures +
 * 軸を立てるために作った検体（`scripts/golden-specimens-halves.mjs`）。
 */
const DEFAULT_SETS = [
  join(ROOT, '.golden/specimens'),
  join(ROOT, 'tests/fixtures'),
  resolve(ROOT, '../../lib/normativepdf/corpus/veraPDF-corpus'),
  resolve(ROOT, '../../lib/normativepdf/corpus/pdf20examples'),
  resolve(ROOT, '../../lib/normativepdf/corpus/_wout'),
];

/** `compare_structure#ref` が全検体を突き合わせる相手。ヘッダに sha を残す。 */
const DEFAULT_REF = join(ROOT, 'tests/fixtures/tagged.pdf');

/** search_text#miss が使う、どの検体にも出ないはずの文字列。 */
const MISS_QUERY = 'QZXJV-該当しない文字列-QZXJV';

/**
 * 呼び出しの一覧。**鍵（key）が比較の単位**で、ツール名ではない。
 * `body`: 'json' = response_format を渡して JSON を凍結する
 *         'text' = response_format を受け取らないツール。本文をそのまま凍結する
 * `args(target)`: file_path 以外に渡すもの。file_path は `own: true` のとき渡さない。
 */
const CALLS = [
  { key: 'get_page_count', tool: 'get_page_count', body: 'json', noFormat: true },
  { key: 'get_metadata', tool: 'get_metadata', body: 'json' },
  { key: 'read_text', tool: 'read_text', body: 'json' },
  {
    key: 'read_text#cols2-compact',
    tool: 'read_text',
    body: 'json',
    args: () => ({ split_columns: 2, compact_whitespace: true }),
  },
  {
    key: 'search_text#hit',
    tool: 'search_text',
    body: 'json',
    args: () => ({ query: 'e', context_chars: 20, max_results: 5 }),
  },
  {
    key: 'search_text#miss',
    tool: 'search_text',
    body: 'json',
    args: () => ({ query: MISS_QUERY, context_chars: 20, max_results: 5 }),
  },
  {
    key: 'read_images',
    tool: 'read_images',
    body: 'text',
    noFormat: true,
    args: () => ({ pages: '1', max_width: 120 }),
  },
  { key: 'read_url', tool: 'read_url', body: 'json', own: true, args: (t) => ({ url: t.url }) },
  {
    key: 'render_page',
    tool: 'render_page',
    body: 'text',
    noFormat: true,
    args: () => ({ pages: '1', dpi: 36, format: 'png' }),
  },
  { key: 'summarize', tool: 'summarize', body: 'json' },
  { key: 'inspect_structure', tool: 'inspect_structure', body: 'json' },
  { key: 'inspect_tags', tool: 'inspect_tags', body: 'json' },
  { key: 'inspect_fonts', tool: 'inspect_fonts', body: 'json' },
  { key: 'inspect_annotations', tool: 'inspect_annotations', body: 'json' },
  { key: 'inspect_signatures', tool: 'inspect_signatures', body: 'json' },
  { key: 'extract_tables', tool: 'extract_tables', body: 'json' },
  { key: 'extract_structured_text', tool: 'extract_structured_text', body: 'json' },
  {
    key: 'extract_structured_text#bbox',
    tool: 'extract_structured_text',
    body: 'json',
    args: () => ({ include_bbox: true }),
  },
  {
    key: 'locate_objects#1-10',
    tool: 'locate_objects',
    body: 'json',
    args: () => ({ object_numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }),
  },
  { key: 'validate_tagged', tool: 'validate_tagged', body: 'json' },
  { key: 'validate_metadata', tool: 'validate_metadata', body: 'json' },
  {
    key: 'compare_structure#self',
    tool: 'compare_structure',
    body: 'json',
    own: true,
    args: (t) => ({ file_path_1: t.path, file_path_2: t.path }),
  },
  {
    key: 'compare_structure#ref',
    tool: 'compare_structure',
    body: 'json',
    own: true,
    args: (t, ctx) => ({ file_path_1: t.path, file_path_2: ctx.ref }),
  },
];

const CALL_KEYS = CALLS.map((c) => c.key);
const CALL_BY_KEY = new Map(CALLS.map((c) => [c.key, c]));
/** 登録されているはずのツール名。実際の登録と食い違ったら take が止まる。 */
const EXPECTED_TOOLS = [...new Set(CALLS.map((c) => c.tool))].sort();

/** 時刻や環境に依存して動く項目。差が出たらまずここを疑う。 */
const TIME_DEPENDENT = [];

const sha = (s) => createHash('sha256').update(s ?? '').digest('hex').slice(0, 16);

/**
 * 出力が JSON として読めなかった entry。`truncateIfNeeded` が長い出力を切るので
 * 大きい文書でだけ起きる。このとき kept は空で、項目を 1 つも取れていない。
 * 🔴 「差が無い」と数えてはいけない。
 * 🔴 `body: 'text'` の呼び出し（read_images / render_page）はもともと JSON を
 * 返さないので、ここには当たらない。
 */
const isUnparsed = (entry) =>
  entry?.format === 'json' && entry?.parsed === false;

/** 本文が空 = 何も測っていない（markdown と text の呼び出し）。 */
const isEmptyText = (entry) =>
  (entry?.format === 'markdown' || entry?.format === 'text') &&
  !String(entry.text ?? '').trim();

/** キー順に依存しない JSON 文字列。 */
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

function listPdfs(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (e.name.startsWith('_stale')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** 集合の名前。パスそのものは環境なので、キーには短い名前だけを使う。 */
function setToken(dir) {
  const b = basename(dir);
  return b === 'veraPDF-corpus' ? 'veraPDF' : b;
}

/** raw の中に出る絶対パスと、take ごとに変わるポート番号を、環境ではない名前に置き換える。 */
function maskPaths(value, masks) {
  if (typeof value === 'string') {
    let s = value;
    for (const [from, to] of masks) s = s.split(from).join(to);
    return s.replace(/http:\/\/127\.0\.0\.1:\d+\//g, '{url}/');
  }
  if (Array.isArray(value)) return value.map((v) => maskPaths(v, masks));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = maskPaths(value[k], masks);
    return out;
  }
  return value;
}

// --------------------------------------------------------------------------
// kept — 判定に効く項目を平らにする。差の分類はここを見て決める。
// --------------------------------------------------------------------------

const N = (v) => (Array.isArray(v) ? v.length : v == null ? null : v);
const len = (v) => (typeof v === 'string' ? v.length : v == null ? 0 : String(v).length);

/** 人が読む本文（markdown / text）から、意味の載っている行だけを取り出す。 */
function keptText(text) {
  const lines = String(text ?? '').split('\n');
  return {
    bytes: String(text ?? '').length,
    lineCount: lines.length,
    headings: lines.filter((l) => l.startsWith('#')),
    tableRows: lines.filter((l) => l.startsWith('|')).length,
    bullets: lines.filter((l) => l.startsWith('- ')),
  };
}

/** ページごとのテキスト抽出の申告（read_text / read_url / extract_structured_text）。 */
function keptPages(list) {
  const pages = Array.isArray(list) ? list : [];
  return {
    pageCount: pages.length,
    chars: pages.map((p) => len(p.text)),
    totalChars: pages.reduce((a, p) => a + len(p.text), 0),
    states: pages.map((p) => p.extractability?.state ?? null),
    unmappable: pages.map((p) => N(p.extractability?.unmappableFonts)),
    showing: pages.map((p) => p.extractability?.textShowingOperators ?? null),
  };
}

/**
 * 応答が申告する射程（0.14.0 から）。
 * 🔴 ここを凍結しないと、「どこまで読んだか」が動いたことを計器が言えない。
 * verify の計器が `observation` を記録しておらず、A/B が差 0 件を出した形と同じ。
 */
function keptScope(raw) {
  const scope = raw?.scope;
  if (!scope || typeof scope !== 'object') return null;
  const out = {};
  for (const [part, outcome] of Object.entries(scope)) {
    out[part] = outcome?.status === 'read' ? 'read' : `failed:${outcome?.code ?? '?'}`;
  }
  return out;
}

function keptOf(key, raw) {
  if (raw == null) return null;
  const tool = CALL_BY_KEY.get(key)?.tool ?? key;
  const scope = keptScope(raw);
  const withScope = (o) => (scope ? { scope, ...o } : o);
  switch (tool) {
    case 'get_page_count':
      return { pageCount: typeof raw === 'number' ? raw : (raw?.pageCount ?? null) };
    case 'get_metadata':
      return {
        pageCount: raw.pageCount ?? null,
        pdfVersion: raw.pdfVersion ?? null,
        isEncrypted: raw.isEncrypted ?? null,
        isTagged: raw.isTagged ?? null,
        isLinearized: raw.isLinearized ?? null,
        hasSignatures: raw.hasSignatures ?? null,
        fileSize: raw.fileSize ?? null,
        // 値そのものではなく「取れたか」。文字列の中身は raw と sha に残っている
        present: ['title', 'author', 'subject', 'keywords', 'creator', 'producer',
          'creationDate', 'modificationDate'].filter((k) => len(raw[k]) > 0),
      };
    case 'read_text':
    case 'read_url':
      // 🔴 0.14.0 で最上位が配列から `{ scope, pages }` になった。
      // **両方の形を読む** —— 片方しか読まないと、形が変わっただけの版で
      // 「1 ページも取れていない」と報告する（実際にそう報告した）。
      return withScope(keptPages(Array.isArray(raw) ? raw : (raw?.pages ?? [])));
    case 'search_text':
      return withScope({
        totalMatches: raw.totalMatches ?? null,
        matches: N(raw.matches),
        truncated: raw.truncated ?? null,
        pagesHit: [...new Set((raw.matches ?? []).map((m) => m.page))].sort((a, b) => a - b),
      });
    case 'summarize':
      return withScope({
        pageCount: raw.metadata?.pageCount ?? null,
        pdfVersion: raw.metadata?.pdfVersion ?? null,
        isTagged: raw.metadata?.isTagged ?? null,
        isEncrypted: raw.metadata?.isEncrypted ?? null,
        hasSignatures: raw.metadata?.hasSignatures ?? null,
        hasText: raw.hasText ?? null,
        imageCount: raw.imageCount ?? null,
        textExtractability: raw.textExtractability ?? null,
        unreadablePages: N(raw.unreadablePages),
        // 🔴 null（その読みが回らなかった）と 0（回って 0 だった）を潰さない
        previewChars: raw.textPreview === null ? null : len(raw.textPreview),
        nextCount: N(raw.next),
      });
    case 'inspect_structure':
      return {
        catalogKeys: (raw.catalog ?? []).map((e) => e.key).sort(),
        catalogTypes: (raw.catalog ?? []).map((e) => `${e.key}:${e.type}`).sort(),
        totalPages: raw.pageTree?.totalPages ?? null,
        mediaBoxSamples: N(raw.pageTree?.mediaBoxSamples),
        totalObjects: raw.objectStats?.totalObjects ?? null,
        streamCount: raw.objectStats?.streamCount ?? null,
        byType: raw.objectStats?.byType ?? null,
        isEncrypted: raw.isEncrypted ?? null,
        pdfVersion: raw.pdfVersion ?? null,
      };
    case 'inspect_tags':
      return {
        isTagged: raw.isTagged ?? null,
        rootRole: raw.rootTag?.role ?? null,
        maxDepth: raw.maxDepth ?? null,
        totalElements: raw.totalElements ?? null,
        roleCounts: raw.roleCounts ?? null,
      };
    case 'inspect_fonts':
      return {
        totalFontCount: raw.totalFontCount ?? null,
        embeddedCount: raw.embeddedCount ?? null,
        subsetCount: raw.subsetCount ?? null,
        pagesScanned: raw.pagesScanned ?? null,
        fonts: (raw.fonts ?? []).map((f) => [
          f.name ?? null, f.type ?? null, f.encoding ?? null,
          f.isEmbedded ?? null, f.isSubset ?? null, N(f.pagesUsed),
        ]),
      };
    case 'inspect_annotations':
      return {
        totalAnnotations: raw.totalAnnotations ?? null,
        bySubtype: raw.bySubtype ?? null,
        pagesWithAnnots: Object.keys(raw.byPage ?? {}).length,
        annotations: N(raw.annotations),
        hasLinks: raw.hasLinks ?? null,
        hasForms: raw.hasForms ?? null,
        hasMarkup: raw.hasMarkup ?? null,
      };
    case 'inspect_signatures':
      return {
        totalFields: raw.totalFields ?? null,
        signedCount: raw.signedCount ?? null,
        unsignedCount: raw.unsignedCount ?? null,
        fields: (raw.fields ?? []).map((f) => [f.fieldName ?? null, f.isSigned ?? null,
          f.subFilter ?? null, f.hasByteRange ?? null]),
      };
    case 'extract_tables':
      return {
        isTagged: raw.isTagged ?? null,
        totalTables: raw.totalTables ?? null,
        tables: (raw.tables ?? []).map((t) => [t.page ?? null, N(t.rows), N(t.headers)]),
        pagesScanned: raw.pagesScanned ?? null,
      };
    case 'extract_structured_text': {
      const els = raw.elements ?? [];
      return withScope({
        isTagged: raw.isTagged === null ? 'null' : (raw.isTagged ?? null),
        lang: raw.lang ?? null,
        // 🔴 null（構造木を読めなかった）と 0（読んで要素が無かった）を分ける
        elements: raw.elements === null ? null : els.length,
        roles: els.map((e) => e.role ?? null),
        totalChars: els.reduce((a, e) => a + len(e.text), 0),
        withBbox: els.filter((e) => e.bbox != null).length,
        // 🔴 bbox が付かなかった要素は `boxNote` で理由を返す。数えないと
        // 「bbox が 0 件」だけが残り、測れなかったのか無かったのかが分からない
        withBoxNote: els.filter((e) => e.boxNote != null).length,
        bboxBasis: [...new Set(els.map((e) => e.bbox?.basis).filter(Boolean))].sort(),
        states: (raw.extractability ?? []).map((p) => p.state ?? null),
      });
    }
    case 'locate_objects':
      return {
        objects: (raw.objects ?? []).map((o) => [
          o.objectNumber ?? null, o.found ?? null, o.type ?? null,
          N(o.locations), o.reason ?? null,
        ]),
        foundCount: (raw.objects ?? []).filter((o) => o.found).length,
        isEncrypted: raw.isEncrypted ?? null,
        notes: N(raw.notes),
      };
    case 'validate_tagged':
    case 'validate_metadata':
      return {
        isTagged: raw.isTagged ?? null,
        totalChecks: raw.totalChecks ?? null,
        passed: raw.passed ?? null,
        failed: raw.failed ?? null,
        warnings: raw.warnings ?? null,
        issues: (raw.issues ?? []).map((i) => [i.severity ?? null, i.code ?? null]),
        metadata: raw.metadata ?? null,
        // 🔴 前提を観測できずに回らなかった検査。0.14.0 で足した項目
        notChecked: (raw.notChecked ?? []).map((n) => n.code).sort(),
      };
    case 'compare_structure':
      return {
        diffs: (raw.diffs ?? []).map((d) => [d.property ?? null, d.status ?? null]),
        onlyInFile1: N(raw.fontComparison?.onlyInFile1),
        onlyInFile2: N(raw.fontComparison?.onlyInFile2),
        inBoth: N(raw.fontComparison?.inBoth),
        summaryChars: len(raw.summary),
      };
    default:
      return null;
  }
}

/** エラー応答は、届け先（isError）と、何を名指ししたかを残す。 */
function keptOfError(raw, text) {
  const msg = typeof raw?.error === 'string' ? raw.error : typeof raw?.message === 'string' ? raw.message : text;
  return {
    code: raw?.code ?? null,
    messageSha: sha(msg),
    hasHint: raw?.hint != null,
    nextActions: (raw?.next_actions ?? []).map((a) => a.action ?? String(a)).sort(),
    cause: raw?.detail?.cause ?? null,
    messageHead: String(msg ?? '').slice(0, 160),
  };
}

/**
 * その呼び出しが「いくつの対象を観測できたか」。減れば E、増えれば F。
 * 🔴 数を取れない呼び出しは null を返す。0 と null は違う ——
 * 0 は「無いと観測した」、null は「観測していない」。
 */
function subjectsOf(key, kept) {
  if (!kept) return null;
  const tool = CALL_BY_KEY.get(key)?.tool ?? key;
  switch (tool) {
    case 'get_page_count': return kept.pageCount;
    case 'get_metadata': return kept.present?.length ?? null;
    case 'read_text':
    case 'read_url': return kept.pageCount ?? null;
    case 'search_text': return kept.totalMatches ?? null;
    case 'summarize': return kept.pageCount ?? null;
    case 'inspect_structure': return kept.totalObjects ?? null;
    case 'inspect_tags': return kept.totalElements ?? null;
    case 'inspect_fonts': return kept.totalFontCount ?? null;
    case 'inspect_annotations': return kept.totalAnnotations ?? null;
    case 'inspect_signatures': return kept.totalFields ?? null;
    case 'extract_tables': return kept.totalTables ?? null;
    case 'extract_structured_text': return kept.elements ?? null;
    case 'locate_objects': return kept.foundCount ?? null;
    case 'validate_tagged':
    case 'validate_metadata': return kept.totalChecks ?? null;
    case 'compare_structure': return kept.diffs?.length ?? null;
    default: return null;
  }
}

/** その呼び出しが取り出せた文字数。減れば N（テキストが読めなくなった）。 */
function charsOf(key, kept) {
  if (!kept) return null;
  const tool = CALL_BY_KEY.get(key)?.tool ?? key;
  if (tool === 'read_text' || tool === 'read_url') return kept.totalChars ?? null;
  if (tool === 'extract_structured_text') return kept.totalChars ?? null;
  if (tool === 'summarize') return kept.previewChars ?? null;
  return null;
}

// --------------------------------------------------------------------------
// take
// --------------------------------------------------------------------------

function depVersions() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const out = { self: pkg.version };
  for (const name of ['pdf-lib', 'pdfjs-dist', '@hyzyla/pdfium', '@normativepdf/recover',
    'normativepdf', '@modelcontextprotocol/server']) {
    const p = join(ROOT, 'node_modules', name, 'package.json');
    out[name] = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).version : null;
  }
  return out;
}

/** 検体を 127.0.0.1 に配る http サーバ。read_url のためだけに立てる。外へは出さない。 */
async function startFileServer(pathByToken) {
  const server = createServer((req, res) => {
    const token = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0]);
    const p = pathByToken.get(token);
    if (!p || !existsSync(p)) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = readFileSync(p);
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': body.length });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

async function take(outPath, opts) {
  const responseFormat = opts.format ?? 'json';
  if (!['json', 'markdown'].includes(responseFormat)) {
    console.error(`--format は json / markdown のどれか: ${responseFormat}`);
    process.exit(2);
  }
  const ref = resolve(opts.ref ?? DEFAULT_REF);
  if (!existsSync(ref)) {
    console.error(`compare_structure#ref の相手が無い: ${ref}\n` +
      'npm run test:fixtures で作るか --ref で指す');
    process.exit(2);
  }

  const sets = (opts.sets.length ? opts.sets : DEFAULT_SETS).map((d) => resolve(d));
  for (const d of sets) {
    if (!existsSync(d)) {
      console.error(`検体集合が無い: ${d}`);
      process.exit(2);
    }
  }

  const masks = sets.map((d) => [`${d}/`, `{${setToken(d)}}/`]);
  masks.push([ref, '{ref}']);
  const targets = [];
  for (const d of sets) {
    const token = setToken(d);
    const manifestPath = join(d, 'manifest.json');
    const manifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, 'utf8'))
      : null;
    const byName = new Map((manifest?.specimens ?? []).map((s) => [s.name, s]));
    for (const p of listPdfs(d)) {
      const rel = relative(d, p);
      targets.push({ key: `{${token}}/${rel}`, path: p, set: token, axes: byName.get(rel)?.axes ?? [] });
    }
  }
  targets.sort((a, b) => a.key.localeCompare(b.key));
  const picked = opts.limit ? targets.slice(0, opts.limit) : targets;
  /**
   * 🔴 分けて採るのは速さのためだけで、答えを変えてはならない。
   * 1 ファイルの中の呼び出しは分けない（順番のある副作用を跨がせない）。
   * 検体を n 本おきに割り当てるので、どの持ち場にも大小の検体が混ざる。
   * 分けて採ったものと 1 プロセスで採ったものが差 0 件になることは、
   * 使う前に 40 検体で実測すること。
   */
  const assigned = opts.shard
    ? picked.filter((_, i) => i % opts.shard.n === opts.shard.k - 1)
    : picked;

  const { McpServer } = await import('@modelcontextprotocol/server');
  const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client');
  const { registerAllTools } = await import('../dist/tools/index.js');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const server = new McpServer({ name: 'golden', version: pkg.version });
  registerAllTools(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'golden', version: '0' });
  await Promise.all([server.connect(st), client.connect(ct)]);

  // 🔴 登録されたツールと CALLS の一覧が食い違ったら止まる。
  // ツールが増えたのに計器が知らなければ、その 1 本は撤去の A/B で一度も測られない。
  const registered = (await client.listTools()).tools.map((t) => t.name).sort();
  const missing = EXPECTED_TOOLS.filter((t) => !registered.includes(t));
  const extra = registered.filter((t) => !EXPECTED_TOOLS.includes(t));
  if (missing.length || extra.length) {
    console.error('登録されたツールと CALLS の一覧が食い違っている:');
    if (missing.length) console.error(`  CALLS にあって登録されていない: ${missing.join(' ')}`);
    if (extra.length) console.error(`  登録されていて CALLS に無い: ${extra.join(' ')}（この分は測られない）`);
    process.exit(2);
  }

  const httpTokens = new Map(picked.map((t, i) => [String(i), t.path]));
  const file = await startFileServer(httpTokens);
  picked.forEach((t, i) => { t.url = `${file.origin}/${i}`; });

  let files = {};
  let calls = 0;
  let errors = 0;
  /** 呼び出しごとの累計ミリ秒。どこに時間が要るかを、推測ではなく採った値で言う。 */
  let msByCall = Object.fromEntries(CALL_KEYS.map((k) => [k, 0]));
  const t0 = Date.now();

  const outResolved = resolve(outPath);
  if (opts.resume && existsSync(outResolved)) {
    const prev = JSON.parse(readFileSync(outResolved, 'utf8'));
    if ((prev.header.responseFormat ?? 'json') !== responseFormat) {
      console.error(`--resume: 形式が違う（${prev.header.responseFormat} に ${responseFormat} を継ぎ足そうとしている）`);
      process.exit(2);
    }
    if (stable(prev.header.deps) !== stable(depVersions())) {
      console.error(`--resume: 版が違う（${JSON.stringify(prev.header.deps)}）。継ぎ足すと 1 つの JSON に 2 つの版が混ざる`);
      process.exit(2);
    }
    if (stable(prev.header.calls) !== stable(CALL_KEYS)) {
      console.error('--resume: 呼び出しの一覧が違う。計器を直したら採り直す');
      process.exit(2);
    }
    files = prev.files;
    calls = prev.header.counts.calls;
    errors = prev.header.counts.errors;
    msByCall = { ...msByCall, ...(prev.header.msByCall ?? {}) };
    console.error(`--resume: ${Object.keys(files).length} 件を引き継ぐ`);
  }

  const buildGolden = (done) => ({
    header: {
      formatVersion: 1,
      label: opts.label ?? basename(outPath, '.json'),
      capturedAt: new Date().toISOString(),
      node: process.version,
      deps: depVersions(),
      responseFormat,
      calls: CALL_KEYS,
      tools: EXPECTED_TOOLS,
      ref: { path: relative(ROOT, ref), sha256: createHash('sha256').update(readFileSync(ref)).digest('hex').slice(0, 32) },
      shard: opts.shard ?? null,
      missQuery: MISS_QUERY,
      timeDependent: TIME_DEPENDENT,
      msByCall,
      complete: done,
      sets: sets.map((d) => ({
        token: setToken(d),
        root: relative(ROOT, d),
        files: picked.filter((t) => t.set === setToken(d)).length,
      })),
      counts: { files: Object.keys(files).length, planned: assigned.length, calls, errors, ms: Date.now() - t0 },
    },
    files,
  });
  const flush = (done) => {
    mkdirSync(dirname(outResolved), { recursive: true });
    writeFileSync(outResolved, `${JSON.stringify(buildGolden(done))}\n`);
  };

  // 🔴 pdfjs-dist の warn() は stdout に出る。ツールを呼んでいる間だけ stderr へ逃がす。
  const realLog = console.log;
  const realWarn = console.warn;
  console.log = (...a) => console.error('[log]', ...a);
  console.warn = (...a) => console.error('[warn]', ...a);

  let stoppedEarly = false;
  try {
    for (let i = 0; i < assigned.length; i++) {
      const t = assigned[i];
      if (files[t.key]) continue;
      if (opts.budgetMs && Date.now() - t0 > opts.budgetMs) {
        stoppedEarly = true;
        break;
      }
      const tFile = Date.now();
      const stat = statSync(t.path);
      const bytes = readFileSync(t.path);
      const entry = {
        set: t.set,
        bytes: stat.size,
        sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 32),
        axes: t.axes,
        calls: {},
      };
      for (const call of CALLS) {
        const args = {
          ...(call.own ? {} : { file_path: t.path }),
          ...(call.noFormat ? {} : { response_format: responseFormat }),
          ...(call.args ? call.args(t, { ref }) : {}),
        };
        let res;
        const tCall = Date.now();
        try {
          res = await client.callTool({ name: call.tool, arguments: args });
        } catch (err) {
          res = { isError: true, content: [{ type: 'text', text: JSON.stringify({ rpcError: String(err) }) }], rpc: true };
        }
        msByCall[call.key] += Date.now() - tCall;
        calls++;
        const content = res.content ?? [];
        const text = String(content.find((c) => c.type === 'text')?.text ?? '');
        const isError = res.isError === true;
        if (isError) errors++;

        // 🔴 画像は base64 をそのまま持たない。枚数・種類・バイト数・sha だけを持つ。
        const blocks = content.map((c) =>
          c.type === 'text'
            ? { type: 'text', bytes: len(c.text) }
            : { type: c.type, mimeType: c.mimeType ?? null, bytes: len(c.data), sha: sha(c.data) });

        // 本文が JSON でない呼び出し（read_images / render_page）と markdown は同じ扱い。
        // 🔴 エラーもここに入れる。markdown を頼んだのに JSON だけ別扱いにすると、
        // 同じ鍵の下に 2 通りの形が混ざり、diff がそれを差として出す。
        const asText = call.body === 'text' || responseFormat === 'markdown';
        if (asText) {
          const body = maskPaths(text, masks);
          entry.calls[call.key] = {
            isError,
            format: call.body === 'text' ? 'text' : 'markdown',
            tool: call.tool,
            channel: res.rpc ? 'jsonrpc' : 'tool-result',
            blocks,
            sha: sha(`${body}|${stable(blocks)}`),
            kept: keptText(body),
            text: body,
          };
          continue;
        }

        let raw;
        let parsed = true;
        try {
          raw = JSON.parse(text);
        } catch {
          raw = { _text: text };
          parsed = false;
        }
        raw = maskPaths(raw, masks);
        entry.calls[call.key] = {
          isError,
          parsed,
          format: 'json',
          tool: call.tool,
          channel: res.rpc ? 'jsonrpc' : 'tool-result',
          blocks,
          sha: sha(`${stable(raw)}|${stable(blocks)}`),
          kept: isError ? keptOfError(raw, text) : parsed ? keptOf(call.key, raw) : null,
          raw,
        };
      }
      files[t.key] = entry;
      // 🔴 時間のかかった検体を名指しする。どこで止まっているのか分からないまま
      // 待つことになるのを避ける（1 検体で 83 秒かかるものが実在した）。
      const fileMs = Date.now() - tFile;
      if (fileMs > 5000) process.stderr.write(`  遅い検体 ${fileMs}ms  ${t.key}\n`);
      if ((i + 1) % 25 === 0) {
        flush(false);
        process.stderr.write(`  ${i + 1}/${assigned.length} (${Date.now() - t0}ms)\n`);
      }
    }
  } finally {
    console.log = realLog;
    console.warn = realWarn;
    await client.close();
    await file.close();
  }

  const done = Object.keys(files).length >= assigned.length;
  flush(done);
  const golden = buildGolden(done);
  if (stoppedEarly || !done) {
    console.log(`\n途中で止めた: ${Object.keys(files).length}/${assigned.length} 件（--budget-ms）。` +
      '同じ引数に --resume を足して続ける');
    console.log(`  🔴 このゴールデンは未完成（header.complete = false）。diff は拒む`);
    return golden;
  }
  if (opts.shard) {
    console.log(`\n持ち場 ${opts.shard.k}/${opts.shard.n} を採った: ${Object.keys(files).length} 検体 / ` +
      `${calls} 呼び出し / ${errors} 件が isError / ${Date.now() - t0}ms -> ${outPath}`);
    console.log('  🔴 これは持ち場 1 つ分。全部そろってから merge して report を読む');
    return golden;
  }
  reportAxes(golden, outPath);
  return golden;
}

// --------------------------------------------------------------------------
// merge — 分けて採った持ち場を 1 つに戻す
// --------------------------------------------------------------------------

/**
 * 🔴 揃わないものを黙って混ぜない。版・形式・呼び出しの一覧・突き合わせ相手・
 * 検体集合のどれかが違えば止まる。持ち場が 1..n を 1 回ずつでなければ止まる。
 * 同じ検体が 2 つの持ち場に居ても止まる（割り当ての誤りが差 0 件の顔をするため）。
 */
function merge(outPath, inputs, opts) {
  const parts = inputs.map((p) => ({ path: p, g: JSON.parse(readFileSync(resolve(p), 'utf8')) }));
  const h0 = parts[0].g.header;
  const same = (get, name) => {
    for (const { path, g } of parts) {
      if (stable(get(g.header)) !== stable(get(h0))) {
        console.error(`${name} が違う: ${parts[0].path} <-> ${path}`);
        return false;
      }
    }
    return true;
  };
  let ok = true;
  ok = same((h) => h.responseFormat, '形式') && ok;
  ok = same((h) => h.deps, '版') && ok;
  ok = same((h) => h.calls, '呼び出しの一覧') && ok;
  ok = same((h) => h.ref, 'compare_structure#ref の相手') && ok;
  ok = same((h) => h.missQuery, 'search_text#miss の文字列') && ok;
  ok = same((h) => h.sets.map((x) => [x.token, x.root, x.files]), '検体集合') && ok;
  if (!ok) return 2;

  const n = h0.shard?.n ?? null;
  if (!n) {
    console.error('持ち場の印（header.shard）が無い。--shard k/n で採ったものだけを merge できる');
    return 2;
  }
  const seen = new Map();
  for (const { path, g } of parts) {
    if (g.header.shard?.n !== n) {
      console.error(`持ち場の分け方が違う: ${path} は n=${g.header.shard?.n}`);
      return 2;
    }
    if (g.header.complete === false) {
      console.error(`持ち場 ${g.header.shard.k} が未完成（${g.header.counts.files}/${g.header.counts.planned}）: ${path}`);
      return 2;
    }
    if (seen.has(g.header.shard.k)) {
      console.error(`持ち場 ${g.header.shard.k} が 2 回出てきた: ${seen.get(g.header.shard.k)} と ${path}`);
      return 2;
    }
    seen.set(g.header.shard.k, path);
  }
  for (let k = 1; k <= n; k++) {
    if (!seen.has(k)) {
      console.error(`持ち場 ${k}/${n} が無い。全部そろってから merge する`);
      return 2;
    }
  }

  const files = {};
  const msByCall = Object.fromEntries((h0.calls ?? CALL_KEYS).map((k) => [k, 0]));
  let calls = 0;
  let errors = 0;
  let ms = 0;
  let planned = 0;
  for (const { path, g } of parts) {
    for (const [k, v] of Object.entries(g.files)) {
      if (files[k]) {
        console.error(`同じ検体が 2 つの持ち場に居る: ${k}（${path}）`);
        return 2;
      }
      files[k] = v;
    }
    for (const [k, v] of Object.entries(g.header.msByCall ?? {})) msByCall[k] = (msByCall[k] ?? 0) + v;
    calls += g.header.counts.calls;
    errors += g.header.counts.errors;
    ms += g.header.counts.ms;
    planned += g.header.counts.planned;
  }
  if (Object.keys(files).length !== planned) {
    console.error(`検体の数が合わない: ${Object.keys(files).length} 件に対し、持ち場の合計は ${planned} 件`);
    return 2;
  }
  const sorted = {};
  for (const k of Object.keys(files).sort()) sorted[k] = files[k];

  const merged = {
    header: {
      ...h0,
      label: opts.label ?? basename(outPath, '.json'),
      capturedAt: new Date().toISOString(),
      shard: null,
      mergedFrom: parts.map(({ path, g }) => ({ shard: g.header.shard.k, path: relative(ROOT, resolve(path)), files: g.header.counts.files })),
      complete: true,
      msByCall,
      counts: { files: Object.keys(sorted).length, planned, calls, errors, ms },
    },
    files: sorted,
  };
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), `${JSON.stringify(merged)}\n`);
  console.log(`${parts.length} 個の持ち場を 1 つにした -> ${outPath}`);
  reportAxes(merged, outPath);
  return 0;
}

/**
 * 🔴 採るたびに軸を申告する。verify の B1 の後退を捕まえたのはこの申告で、
 * 判定の A/B ではなかった。「1 形しか無い軸」は、その軸を持つ検体が集合に居ないこと。
 */
function reportAxes(golden, outPath) {
  const files = Object.entries(golden.files);
  const keys = golden.header.calls ?? CALL_KEYS;
  console.log(`\n採った: ${files.length} 検体 / ${golden.header.counts.calls} 呼び出し / ` +
    `${golden.header.counts.errors} 件が isError / ${golden.header.counts.ms}ms -> ${outPath}`);
  for (const s of golden.header.sets) console.log(`  集合 ${s.token}: ${s.files} 件  (${s.root})`);
  console.log(`  形式: ${golden.header.responseFormat ?? 'json'}  / 完成: ${golden.header.complete}`);
  console.log(`  版: ${JSON.stringify(golden.header.deps)}`);
  console.log(`  compare_structure#ref の相手: ${golden.header.ref?.path} (${golden.header.ref?.sha256})`);

  // 🔴 何も測っていない呼び出しを、差が無いことと分けて先に出す
  const unparsed = [];
  const empty = [];
  for (const [k, e] of files) {
    for (const key of keys) {
      if (isUnparsed(e.calls[key])) unparsed.push(`${k} / ${key}`);
      if (isEmptyText(e.calls[key])) empty.push(`${k} / ${key}`);
    }
  }
  if (unparsed.length) {
    console.log(`\n  🔴 出力が JSON として読めなかった: ${unparsed.length} 件（切り詰め。項目を 1 つも取れていない）`);
    for (const k of unparsed.slice(0, 20)) console.log(`    ${k}`);
    if (unparsed.length > 20) console.log(`    … 残り ${unparsed.length - 20} 件`);
  }
  if (empty.length) {
    console.log(`\n  🔴 本文が空: ${empty.length} 件（項目を 1 つも取れていない）`);
    for (const k of empty.slice(0, 20)) console.log(`    ${k}`);
    if (empty.length > 20) console.log(`    … 残り ${empty.length - 20} 件`);
  }

  // 呼び出しごとの isError の数と所要時間。ツールではなく呼び出しの単位で見る
  const ms = golden.header.msByCall ?? {};
  const totalMs = Object.values(ms).reduce((a, b) => a + b, 0) || 1;
  console.log('\n  呼び出しごとの isError と所要時間:');
  for (const key of keys) {
    const n = files.filter(([, e]) => e.calls[key]?.isError).length;
    const m = ms[key] ?? 0;
    console.log(`    ${key.padEnd(30)} isError ${String(n).padStart(5)}/${files.length}` +
      `   ${String(m).padStart(7)}ms (${((m / totalMs) * 100).toFixed(1)}%)`);
  }

  // 軸（manifest 由来）の分布
  const axisCount = {};
  for (const [, e] of files) for (const a of e.axes) axisCount[a] = (axisCount[a] ?? 0) + 1;
  const axes = Object.keys(axisCount).sort();
  if (axes.length) {
    console.log(`\n  申告した軸 (${axes.length}):`);
    for (const a of axes) console.log(`    ${a.padEnd(26)} ${axisCount[a]}`);
  }

  // 1 形しか無い軸 = kept の中で、全検体を通して 1 つの値しか取らない信号
  const signals = {};
  const push = (k, v) => ((signals[k] ??= new Set()).add(stable(v)));
  /**
   * 🔴 辞書は 1 段ずつ降りる。降りずに捨てると、`byType` や `roleCounts` のように
   * 鍵の下に信号が入っている軸を「1 形しか無い = null」と誤報する
   * （verify で実測した壊れ方）。配列は数えない。
   */
  const pushSignal = (k, v, depth = 0) => {
    if (Array.isArray(v)) return;
    if (v && typeof v === 'object') {
      if (depth >= 2) return;
      for (const [k2, v2] of Object.entries(v)) pushSignal(`${k}.${k2}`, v2, depth + 1);
      return;
    }
    push(k, v);
  };
  for (const [, e] of files) {
    for (const key of keys) {
      const t = e.calls[key];
      if (!t) continue;
      push(`${key}.isError`, t.isError);
      if (t.isError || !t.kept) continue;
      for (const [k, v] of Object.entries(t.kept)) pushSignal(`${key}.${k}`, v);
    }
  }
  const names = Object.keys(signals);
  const single = Object.entries(signals).filter(
    ([k, s]) => s.size <= 1 && !names.some((o) => o.startsWith(`${k}.`)),
  );
  console.log(`\n  🔴 1 形しか無い軸 (${single.length}/${names.length}) —— この集合ではその軸が動いていない:`);
  for (const [k, s] of single) console.log(`    ${k.padEnd(44)} = ${[...s][0]}`);
}

// --------------------------------------------------------------------------
// diff
// --------------------------------------------------------------------------

/** raw の深い比較。差の場所を JSON ポインタで名指しする。 */
function deepDiff(a, b, path = '', out = [], cap = 40) {
  if (out.length >= cap) return out;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) {
    out.push({ path: path || '/', before: brief(a), after: brief(b) });
    return out;
  }
  if (ta === 'array') {
    if (a.length !== b.length) out.push({ path: `${path}/length`, before: a.length, after: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i++) deepDiff(a[i], b[i], `${path}/${i}`, out, cap);
    return out;
  }
  if (ta === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]).values()) {
      if (!(k in a)) out.push({ path: `${path}/${k}`, before: undefined, after: brief(b[k]) });
      else if (!(k in b)) out.push({ path: `${path}/${k}`, before: brief(a[k]), after: undefined });
      else deepDiff(a[k], b[k], `${path}/${k}`, out, cap);
      if (out.length >= cap) break;
    }
    return out;
  }
  if (a !== b) out.push({ path: path || '/', before: a, after: b });
  return out;
}

function brief(v) {
  const s = stable(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

const B_A = 'A 読めた -> 読めない';
const B_B = 'B 読めない -> 読めた';
const B_C = 'C 判定が変わった（pass が減る・failed が増える）';
const B_D = 'D 🔴 反証できなくなった（failed が減る・検査の数が減る）';
const B_E = 'E 観測できた対象が減った';
const B_F = 'F 観測できた対象が増えた';
const B_N2 = 'N 🔴 取り出せた文字が減った';
const B_O = 'O 取り出せた文字が増えた';
const B_P = 'P 返した画像が変わった（枚数・バイト列）';

/**
 * B_P に当てるのは**画像などのブロックだけ**である。
 *
 * 🔴 2026-08-31: ここは `blocks` を丸ごと比べていた。`blocks` は本文ブロックの
 * バイト数も持っているので、`isEncrypted` が true/false で 1 バイト動いただけの差が
 * 96 件すべて「返した画像が変わった」と名乗った。**画像は 1 枚も動いていない。**
 * 帰属は分類の名前を読んで行うので、名前が別のものを指していたら帰属できない。
 * 本文の差は N/O（文字数）・K/L（行）・G（その他）が持っているので、ここでは見ない。
 */
const imageBlocks = (blocks) => (blocks ?? []).filter((b) => b.type !== 'text');
const B_H = 'H 🔴 出力が切り詰められて JSON にならない（項目を 1 つも取れていない）';
const B_M = 'M 🔴 本文が空（項目を 1 つも取れていない）';
const B_I = 'I 並びだけが違う（行の集合と中身は同じ）';
const B_K = 'K 本文から行が消えた';
const B_L = 'L 本文に行が増えた';
const B_J = 'J 前の版に無かった項目が増えただけ（判定は動いていない）';
const B_G = 'G その他（帰属が要る）';
const BUCKETS = [B_A, B_B, B_D, B_C, B_N2, B_E, B_O, B_F, B_P, B_H, B_M, B_I, B_K, B_L, B_J, B_G];

/**
 * 人が読む本文（markdown / text）の差を割り当てる。
 * 🔴 json の分類（pass -> fail・対象の数）はここでは使えない。本文からは判定を
 * 取り出していないので、取り出せるふりをすると「測っていないこと」が
 * 「差が無いこと」の顔をする。ここで言えるのは行が消えた・増えた・並びが違うの 3 つと、
 * 画像ブロックが変わったことだけである。
 */
function classifyText(before, after) {
  if (isEmptyText(before) || isEmptyText(after)) return [B_M];
  if (!before.isError && after.isError) return [B_A];
  if (before.isError && !after.isError) return [B_B];
  const s = new Set();
  if (stable(imageBlocks(before.blocks)) !== stable(imageBlocks(after.blocks))) s.add(B_P);
  const la = String(before.text ?? '').split('\n');
  const lb = String(after.text ?? '').split('\n');
  if (la.join('\n') !== lb.join('\n')) {
    const sa = [...la].sort().join('\n');
    const sb = [...lb].sort().join('\n');
    if (sa === sb) s.add(B_I);
    else {
      const ca = new Map();
      for (const l of la) ca.set(l, (ca.get(l) ?? 0) + 1);
      const cb = new Map();
      for (const l of lb) cb.set(l, (cb.get(l) ?? 0) + 1);
      for (const [l, n] of ca) if ((cb.get(l) ?? 0) < n) s.add(B_K);
      for (const [l, n] of cb) if ((ca.get(l) ?? 0) < n) s.add(B_L);
    }
  }
  if (s.size === 0) s.add(B_G);
  return BUCKETS.filter((name) => s.has(name));
}

/**
 * 1 ファイル 1 呼び出しの差を、受入の表（§6 面 2）の行に割り当てる。
 * 🔴 **当てはまる行を全部返す。** 1 つに畳むと、原因（対象が減った）を
 * 結果（判定が変わった）が隠す。
 */
function classify(key, before, after) {
  if (before?.format !== 'json' || after?.format !== 'json') return classifyText(before, after);
  if (isUnparsed(before) || isUnparsed(after)) return [B_H];
  if (!before.isError && after.isError) return [B_A];
  if (before.isError && !after.isError) return [B_B];
  if (before.isError && after.isError) return [B_G];
  const a = before.kept ?? {};
  const b = after.kept ?? {};
  const s = new Set();

  if (stable(imageBlocks(before.blocks)) !== stable(imageBlocks(after.blocks))) s.add(B_P);

  const sa = subjectsOf(key, a);
  const sb = subjectsOf(key, b);
  if (sa != null && sb != null) {
    if (sb < sa) s.add(B_E);
    if (sb > sa) s.add(B_F);
  } else if (sa != null && sb == null) s.add(B_E);

  const ca = charsOf(key, a);
  const cb = charsOf(key, b);
  if (ca != null && cb != null) {
    if (cb < ca) s.add(B_N2);
    if (cb > ca) s.add(B_O);
  }

  const tool = CALL_BY_KEY.get(key)?.tool ?? key;

  if (tool === 'validate_tagged' || tool === 'validate_metadata') {
    if ((a.failed ?? 0) < (b.failed ?? 0)) s.add(B_C);
    if ((a.failed ?? 0) > (b.failed ?? 0)) s.add(B_D);
    if ((a.passed ?? 0) > (b.passed ?? 0)) s.add(B_C);
    if ((a.totalChecks ?? 0) > (b.totalChecks ?? 0)) s.add(B_D);
    const ia = new Set((a.issues ?? []).map((x) => x.join(' ')));
    const ib = new Set((b.issues ?? []).map((x) => x.join(' ')));
    for (const x of ia) if (!ib.has(x)) s.add(B_D);
  }

  // ページごとのテキスト抽出の申告が「読めた」から降りたら、判定が変わったのと同じ重み
  if (Array.isArray(a.states) && Array.isArray(b.states)) {
    for (let i = 0; i < Math.min(a.states.length, b.states.length); i++) {
      if (a.states[i] === 'extracted' && b.states[i] !== 'extracted') s.add(B_C);
      if (a.states[i] !== 'extracted' && b.states[i] === 'extracted') s.add(B_B);
    }
  }

  // locate_objects: 見つかっていた対象が見つからなくなる
  if (tool === 'locate_objects') {
    const ma = new Map((a.objects ?? []).map((o) => [o[0], o]));
    const mb = new Map((b.objects ?? []).map((o) => [o[0], o]));
    for (const [n2, oa] of ma) {
      const ob = mb.get(n2);
      if (!ob) s.add(B_E);
      else if (oa[1] === true && ob[1] !== true) s.add(B_E);
    }
  }

  // inspect_fonts: 埋め込み済みが未埋め込みに見えるようになる（逆は是正のことがある）
  if (tool === 'inspect_fonts') {
    if ((a.embeddedCount ?? 0) > (b.embeddedCount ?? 0)) s.add(B_E);
    if ((a.embeddedCount ?? 0) < (b.embeddedCount ?? 0)) s.add(B_F);
  }

  // 行の集合と中身が同じで並びだけ違う場合は、そう名指しする
  if (s.size === 0) {
    for (const field of ['fonts', 'roles', 'issues', 'diffs', 'objects', 'catalogKeys']) {
      const xa = a[field];
      const xb = b[field];
      if (!Array.isArray(xa) || !Array.isArray(xb)) continue;
      const ka2 = xa.map(stable).sort().join('|');
      const kb2 = xb.map(stable).sort().join('|');
      if (ka2 === kb2 && stable(xa) !== stable(xb)) s.add(B_I);
    }
  }

  // 出力に項目が増えただけ（前の版に無かったキーしか差が無い）なら、判定は動いていない
  if (s.size === 0) {
    const d = deepDiff(before.raw, after.raw, '', [], 200);
    if (d.length > 0 && d.length < 200 && d.every((x) => x.before === undefined)) s.add(B_J);
  }

  if (s.size === 0) return [B_G];
  return BUCKETS.filter((name) => s.has(name));
}

function diff(beforePath, afterPath, opts) {
  const A = JSON.parse(readFileSync(resolve(beforePath), 'utf8'));
  const B = JSON.parse(readFileSync(resolve(afterPath), 'utf8'));

  const fa = A.header.responseFormat ?? 'json';
  const fb = B.header.responseFormat ?? 'json';
  if (fa !== fb) {
    console.error(`形式が違うゴールデンは突き合わせられない: ${fa} <-> ${fb}`);
    console.error('同じ --format で採り直してから比べること。');
    return 2;
  }
  // 🔴 途中で止めたゴールデンは、採れていない検体が「消えた」の顔をする
  for (const [name, g] of [['before', A], ['after', B]]) {
    if (g.header.complete === false) {
      console.error(`${name} が未完成（header.complete = false・` +
        `${g.header.counts.files}/${g.header.counts.planned} 件）。--resume で採り切ってから比べること。`);
      return 2;
    }
  }
  if (stable(A.header.calls) !== stable(B.header.calls)) {
    console.error('呼び出しの一覧が違う。計器を直したら両側を採り直す。');
    console.error(`  before にだけある: ${(A.header.calls ?? []).filter((k) => !(B.header.calls ?? []).includes(k)).join(' ') || '(なし)'}`);
    console.error(`  after にだけある : ${(B.header.calls ?? []).filter((k) => !(A.header.calls ?? []).includes(k)).join(' ') || '(なし)'}`);
    return 2;
  }
  const keys = A.header.calls ?? CALL_KEYS;

  console.log(`before: ${A.header.label}  ${A.header.capturedAt}  [${fa}]  ${JSON.stringify(A.header.deps)}`);
  console.log(`after : ${B.header.label}  ${B.header.capturedAt}  [${fb}]  ${JSON.stringify(B.header.deps)}`);
  if (A.header.ref?.sha256 !== B.header.ref?.sha256) {
    console.log(`  🔴 compare_structure#ref の相手が違う: ${A.header.ref?.sha256} -> ${B.header.ref?.sha256}`);
  }

  const ka = Object.keys(A.files);
  const kb = Object.keys(B.files);
  const setA = new Set(ka);
  const setB = new Set(kb);
  const removed = ka.filter((k) => !setB.has(k));
  const added = kb.filter((k) => !setA.has(k));
  console.log(`\n検体: before ${ka.length} / after ${kb.length}` +
    (removed.length || added.length
      ? `  （消えた ${removed.length} / 増えた ${added.length}）`
      : '  （同じ集合）'));
  for (const k of removed.slice(0, 10)) console.log(`  - ${k}`);
  for (const k of added.slice(0, 10)) console.log(`  + ${k}`);

  if (opts.detail) {
    const a = A.files[opts.detail];
    const b = B.files[opts.detail];
    if (!a || !b) {
      console.error(`--detail: ${opts.detail} が片方に無い`);
      process.exit(2);
    }
    let shown = 0;
    for (const key of keys) {
      if (a.calls[key]?.sha === b.calls[key]?.sha) continue;
      shown++;
      console.log(`\n=== ${opts.detail} / ${key}  (${classify(key, a.calls[key], b.calls[key]).join(' + ')})`);
      console.log(`isError ${a.calls[key].isError} -> ${b.calls[key].isError}`);
      if (stable(a.calls[key].blocks) !== stable(b.calls[key].blocks)) {
        console.log(`  ブロック ${stable(a.calls[key].blocks)}\n        -> ${stable(b.calls[key].blocks)}`);
      }
      if (a.calls[key].format !== 'json') {
        const la = String(a.calls[key].text ?? '').split('\n');
        const lb = String(b.calls[key].text ?? '').split('\n');
        for (let i = 0; i < Math.max(la.length, lb.length); i++) {
          if (la[i] === lb[i]) continue;
          console.log(`  行 ${i + 1}\n    - ${la[i] ?? '(無し)'}\n    + ${lb[i] ?? '(無し)'}`);
        }
        continue;
      }
      for (const d of deepDiff(a.calls[key].raw, b.calls[key].raw, '', [], 200)) {
        console.log(`  ${d.path}\n    - ${d.before}\n    + ${d.after}`);
      }
    }
    if (!shown) console.log('\nこのファイルには差が無い');
    return shown || removed.length || added.length ? 1 : 0;
  }

  const byBucket = new Map(BUCKETS.map((n) => [n, []]));
  const byCall = {};
  let changed = 0;
  for (const k of ka) {
    if (!setB.has(k)) continue;
    const a = A.files[k];
    const b = B.files[k];
    if (a.sha256 !== b.sha256) {
      byBucket.get(B_G).push(`${k} [検体のバイト列が違う]`);
      changed++;
      continue;
    }
    for (const key of keys) {
      const ta = a.calls[key];
      const tb = b.calls[key];
      if (!ta || !tb || ta.sha === tb.sha) continue;
      changed++;
      byCall[key] = (byCall[key] ?? 0) + 1;
      for (const name of classify(key, ta, tb)) byBucket.get(name).push(`${k} / ${key}`);
    }
  }

  console.log(`\n差: ${changed} 件（ファイル×呼び出し）。` +
    '下の分類は重複する —— 1 件が複数の行に当たることがある');
  for (const [key, n] of Object.entries(byCall).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${key.padEnd(30)} ${n}`);
  }
  console.log('');
  const max = opts.max ?? 12;
  for (const name of BUCKETS) {
    const list = byBucket.get(name);
    if (!list.length) continue;
    console.log(`${name}: ${list.length}`);
    for (const l of list.slice(0, max)) console.log(`    ${l}`);
    if (list.length > max) console.log(`    … 残り ${list.length - max} 件（--max で増やす）`);
  }
  if (!changed && !removed.length && !added.length) console.log('差なし');
  return changed || removed.length || added.length ? 1 : 0;
}

// --------------------------------------------------------------------------
// t3 — 計器自身を壊して、差が出ることを実測する。採る前に通す
// --------------------------------------------------------------------------

function capture(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let code;
  try {
    code = fn();
  } finally {
    console.log = orig;
  }
  return { code, text: lines.join('\n') };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

/** raw か text を書き換えたら kept と sha を採り直す。片方だけ動かすと計器が嘘をつく。 */
function refresh(entry, key) {
  if (entry.format !== 'json') {
    entry.kept = keptText(entry.text);
    entry.sha = sha(`${entry.text}|${stable(entry.blocks)}`);
    return;
  }
  entry.kept = entry.isError ? entry.kept : entry.parsed === false ? null : keptOf(key, entry.raw);
  entry.sha = sha(`${stable(entry.raw)}|${stable(entry.blocks)}`);
}

/** 壊した写しを 1 件ずつ diff にかけ、差を報告したかを見る。 */
function runCases(base, write, cases, missing, goldenPath, format, count) {
  console.log(`計器の T-3: ${goldenPath}（検体 ${count}・形式 ${format}）`);
  if (missing.length) {
    console.log(`🔴 壊す先が集合に無い検査がある: ${missing.join(' ')}`);
    console.log('   その検査は「通った」のではなく、何も測っていない。');
  }
  let failed = 0;
  for (const c of cases) {
    // 🔴 壊す先が無い検査は、飛ばすのではなく「回らなかった」と出して次へ進む。
    // 落ちて止まると残りの検査も回らない（verify で実測した壊れ方）。
    let mutated;
    try {
      mutated = c.mutate(clone(c.src));
    } catch (e) {
      failed++;
      console.log(`  🔴 NG ${c.name} —— 壊す先が無くて回らなかった: ${e.message}`);
      continue;
    }
    const p = write(`case-${c.name.split(' ')[0]}`, mutated);
    const { code, text } = capture(() => diff(base, p, {}));
    const ok = c.expect(text, code);
    if (!ok) failed++;
    console.log(`  ${ok ? 'OK  ' : '🔴 NG'} ${c.name}`);
    if (!ok) console.log(text.split('\n').map((l) => `        ${l}`).join('\n'));
  }
  console.log(failed ? `\n🔴 ${failed} 件の自己検査に失敗` : `\n${cases.length} 件とも差を報告した`);
  return failed || missing.length ? 2 : 0;
}

function t3(goldenPath) {
  const src = JSON.parse(readFileSync(resolve(goldenPath), 'utf8'));
  if (src.header.complete === false) {
    console.error(`t3 に渡すゴールデンが未完成（${src.header.counts.files}/${src.header.counts.planned}）。採り切ってから回す`);
    return 2;
  }
  const tmp = join(process.env.TMPDIR || '/tmp', 'pdf-reader-golden-t3');
  mkdirSync(tmp, { recursive: true });
  const write = (name, obj) => {
    const p = join(tmp, `${name}.json`);
    writeFileSync(p, JSON.stringify(obj));
    return p;
  };
  const base = write('base', src);
  const fileKeys = Object.keys(src.files);
  const find = (pred) => fileKeys.find((k) => {
    try { return pred(src.files[k]); } catch { return false; }
  });
  const format = src.header.responseFormat ?? 'json';

  const cases = [];
  const add = (name, mutate, expect) => cases.push({ name, mutate, expect, src });
  add('0 空振り（同じものを比べる）', (g) => g, (t) => t.includes('差なし'));

  // どの形式でも回る検査 —— 未完成・形式違い・一覧違いで止まること
  add('X1 🔴 未完成のゴールデンとは比べない', (g) => {
    g.header.complete = false;
    return g;
  }, (t, code) => code === 2 && !/差:/.test(t));
  add('X2 🔴 形式の違うゴールデンとは比べない', (g) => {
    g.header.responseFormat = format === 'json' ? 'markdown' : 'json';
    return g;
  }, (t, code) => code === 2 && !/差:/.test(t));
  add('X3 🔴 呼び出しの一覧が違うゴールデンとは比べない', (g) => {
    g.header.calls = g.header.calls.slice(0, -1);
    return g;
  }, (t, code) => code === 2 && !/差:/.test(t));

  const okKey = find((f) => !f.calls.inspect_structure.isError);
  // 🔴 read_url は 0.13.0 では全検体で isError になる（pdfjs に渡した配列を
  // そのまま使い回している。docs/handoff/pdflib-removal.md の「先に直すもの」）。
  // そこを壊す先にすると、この検査は「読めない文書」ではなくその不具合を測ることになる。
  const errKey = find((f) => CALL_KEYS.some((k) => k !== 'read_url' && f.calls[k]?.isError));
  const missing = [];
  if (!okKey) missing.push('okKey');
  if (!errKey) missing.push('errKey');

  add('X4 検体を 1 件落とす', (g) => {
    delete g.files[okKey];
    return g;
  }, (t) => /消えた 1 /.test(t));

  if (format !== 'json') {
    // markdown のゴールデン —— 本文の変化が差として出るかだけを測る。
    // 🔴 判定（pass -> fail・対象の数）は本文からは取り出していないので、ここでは測れない。
    const bodyKey = find((f) => (f.calls.inspect_structure.kept?.lineCount ?? 0) > 4);
    if (!bodyKey) missing.push('bodyKey');
    add('M1 読めた -> 読めない（isError を立てる）', (g) => {
      const e = g.files[okKey].calls.inspect_structure;
      e.isError = true;
      e.text = 'INVALID_PDF';
      refresh(e, 'inspect_structure');
      return g;
    }, (t) => /^A 読めた -> 読めない: 1$/m.test(t));
    add('M2 読めない -> 読めた（isError を落とす）', (g) => {
      const key = CALL_KEYS.find((k) => k !== 'read_url' && g.files[errKey].calls[k]?.isError);
      const e = g.files[errKey].calls[key];
      e.isError = false;
      e.text = `${e.text}\n`;
      refresh(e, key);
      return g;
    }, (t) => /^B 読めない -> 読めた: 1$/m.test(t));
    add('M3 本文から行を 1 つ落とす', (g) => {
      const e = g.files[bodyKey].calls.inspect_structure;
      const lines = e.text.split('\n');
      lines.splice(2, 1);
      e.text = lines.join('\n');
      refresh(e, 'inspect_structure');
      return g;
    }, (t) => /^K 本文から行が消えた/m.test(t));
    add('M4 本文に行を 1 つ足す', (g) => {
      const e = g.files[bodyKey].calls.inspect_structure;
      e.text = `${e.text}\n- T-3 で足した行`;
      refresh(e, 'inspect_structure');
      return g;
    }, (t) => /^L 本文に行が増えた/m.test(t));
    add('M5 行の並びだけ入れ替える', (g) => {
      const e = g.files[bodyKey].calls.inspect_structure;
      e.text = e.text.split('\n').reverse().join('\n');
      refresh(e, 'inspect_structure');
      return g;
    }, (t) => /^I 並びだけが違う/m.test(t));
    add('M6 🔴 本文を空にする（何も測っていない）', (g) => {
      const e = g.files[bodyKey].calls.inspect_structure;
      e.text = '';
      refresh(e, 'inspect_structure');
      return g;
    }, (t) => /^M 🔴 本文が空/m.test(t));
    add('M7 返した画像を差し替える', (g) => {
      const e = g.files[imgKeyOf(g)].calls.render_page;
      e.blocks = e.blocks.map((b) => (b.type === 'image' ? { ...b, sha: 'T3T3T3T3' } : b));
      refresh(e, 'render_page');
      return g;
    }, (t) => /^P 返した画像が変わった/m.test(t));
    const imgSeed = find((f) => (f.calls.render_page?.blocks ?? []).some((b) => b.type === 'image'));
    if (!imgSeed) missing.push('imgKey');
    return runCases(base, write, cases, missing, goldenPath, format, fileKeys.length);
  }

  // ---- json のゴールデン ----
  const failKey = find((f) => !f.calls.validate_metadata.isError && (f.calls.validate_metadata.kept?.failed ?? 0) > 0);
  const passKey = find((f) => !f.calls.validate_metadata.isError && (f.calls.validate_metadata.kept?.passed ?? 0) > 0);
  // 🔴 2 つ以上でないと「並びだけ入れ替える」が何も動かさず、検査が空振りする
  const fontKey = find((f) => !f.calls.inspect_fonts.isError && (f.calls.inspect_fonts.kept?.fonts?.length ?? 0) > 1);
  const textKey = find((f) => !f.calls.read_text.isError && (f.calls.read_text.kept?.totalChars ?? 0) > 10);
  const locKey = find((f) => !f.calls['locate_objects#1-10'].isError && (f.calls['locate_objects#1-10'].kept?.foundCount ?? 0) > 0);
  const imgKey = find((f) => (f.calls.render_page?.blocks ?? []).some((b) => b.type === 'image'));
  for (const [n, v] of Object.entries({ failKey, passKey, fontKey, textKey, locKey, imgKey })) {
    if (!v) missing.push(n);
  }

  add('1 読めた -> 読めない（isError を立てる）', (g) => {
    const e = g.files[okKey].calls.inspect_structure;
    e.isError = true;
    e.raw = { error: 'The file does not appear to be a valid PDF.', code: 'INVALID_PDF' };
    e.kept = keptOfError(e.raw, e.raw.error);
    e.sha = sha(`${stable(e.raw)}|${stable(e.blocks)}`);
    return g;
  }, (t) => /^A 読めた -> 読めない: 1$/m.test(t));

  add('2 読めない -> 読めた（isError を落とす）', (g) => {
    const key = CALL_KEYS.find((k) => k !== 'read_url' && g.files[errKey].calls[k]?.isError && g.files[errKey].calls[k]?.format === 'json');
    const e = g.files[errKey].calls[key];
    e.isError = false;
    e.raw = {};
    refresh(e, key);
    return g;
  }, (t) => /^B 読めない -> 読めた: 1$/m.test(t));

  add('3 検査が 1 つ落ちるようになった（passed -> failed）', (g) => {
    const e = g.files[passKey].calls.validate_metadata;
    e.raw.passed -= 1;
    e.raw.failed = (e.raw.failed ?? 0) + 1;
    refresh(e, 'validate_metadata');
    return g;
  }, (t) => /^C 判定が変わった/m.test(t));

  add('4 🔴 落ちていた検査が通るようになった（failed -> passed）', (g) => {
    const e = g.files[failKey].calls.validate_metadata;
    e.raw.failed -= 1;
    e.raw.passed = (e.raw.passed ?? 0) + 1;
    refresh(e, 'validate_metadata');
    return g;
  }, (t) => /^D 🔴 反証できなくなった/m.test(t));

  add('5 🔴 検査の数を 1 減らす', (g) => {
    const e = g.files[passKey].calls.validate_metadata;
    e.raw.totalChecks -= 1;
    refresh(e, 'validate_metadata');
    return g;
  }, (t) => /^D 🔴 反証できなくなった/m.test(t));

  add('6 観測できたフォントを 1 つ落とす', (g) => {
    const e = g.files[fontKey].calls.inspect_fonts;
    e.raw.fonts.pop();
    e.raw.totalFontCount -= 1;
    refresh(e, 'inspect_fonts');
    return g;
  }, (t) => /^E 観測できた対象が減った/m.test(t));

  add('7 観測できたフォントが 1 つ増える', (g) => {
    const e = g.files[fontKey].calls.inspect_fonts;
    e.raw.fonts.push({ name: 'T3', type: 'Type1', encoding: null, isEmbedded: false, isSubset: false, pagesUsed: [1] });
    e.raw.totalFontCount += 1;
    refresh(e, 'inspect_fonts');
    return g;
  }, (t) => /^F 観測できた対象が増えた/m.test(t));

  // 🔴 0.14.0 で read_text の最上位が配列から `{ scope, pages }` になった。
  // 壊す先も両方の形を見る —— 古いゴールデンを t3 にかけても回るように。
  const pagesOf = (entry) => (Array.isArray(entry.raw) ? entry.raw : entry.raw.pages);

  add('8 🔴 取り出せた文字が減る', (g) => {
    const e = g.files[textKey].calls.read_text;
    const p = pagesOf(e).find((x) => len(x.text) > 5);
    p.text = p.text.slice(0, 3);
    refresh(e, 'read_text');
    return g;
  }, (t) => /^N 🔴 取り出せた文字が減った/m.test(t));

  add('9 取り出せた文字が増える', (g) => {
    const e = g.files[textKey].calls.read_text;
    const p = pagesOf(e)[0];
    p.text = `${p.text}T-3`;
    refresh(e, 'read_text');
    return g;
  }, (t) => /^O 取り出せた文字が増えた/m.test(t));

  add('10 ページの抽出の申告が extracted から降りる', (g) => {
    const e = g.files[textKey].calls.read_text;
    const p = pagesOf(e).find((x) => x.extractability?.state === 'extracted');
    p.extractability.state = 'not_extractable';
    refresh(e, 'read_text');
    return g;
  }, (t) => /^C 判定が変わった/m.test(t));

  add('18 🔴 射程だけが動く（判定は動かない）', (g) => {
    const e = g.files[textKey].calls.read_text;
    e.raw.scope = {
      textExtraction: { status: 'read' },
      extractabilityObservation: { status: 'failed', code: 'INVALID_PDF', reason: 'T-3' },
    };
    refresh(e, 'read_text');
    return g;
  }, (t) => /差: [1-9]/.test(t) && /read_text/.test(t));

  add('11 見つかっていたオブジェクトが見つからなくなる', (g) => {
    const e = g.files[locKey].calls['locate_objects#1-10'];
    const o = e.raw.objects.find((x) => x.found);
    o.found = false;
    o.locations = [];
    refresh(e, 'locate_objects#1-10');
    return g;
  }, (t) => /^E 観測できた対象が減った/m.test(t));

  add('12 返した画像が差し替わる', (g) => {
    const e = g.files[imgKey].calls.render_page;
    e.blocks = e.blocks.map((b) => (b.type === 'image' ? { ...b, sha: 'T3T3T3T3' } : b));
    refresh(e, 'render_page');
    return g;
  }, (t) => /^P 返した画像が変わった/m.test(t));

  add('13 🔴 出力を JSON にならない形にする（切り詰め）', (g) => {
    const e = g.files[okKey].calls.inspect_structure;
    e.raw = { _text: '{ "catalog": [ { "key": "Ty' };
    e.parsed = false;
    e.kept = null;
    e.sha = sha(`${stable(e.raw)}|${stable(e.blocks)}`);
    return g;
  }, (t) => /^H 🔴 出力が切り詰められて/m.test(t));

  add('14 並びだけ入れ替える', (g) => {
    const e = g.files[fontKey].calls.inspect_fonts;
    e.raw.fonts = [...e.raw.fonts].reverse();
    refresh(e, 'inspect_fonts');
    return g;
  }, (t) => /^I 並びだけが違う/m.test(t));

  add('15 出力に項目が増えただけ', (g) => {
    const e = g.files[okKey].calls.inspect_structure;
    e.raw.observation = { scope: 'T-3' };
    refresh(e, 'inspect_structure');
    return g;
  }, (t) => /^J 前の版に無かった項目が増えただけ/m.test(t));

  add('16 🔴 項目が増え、かつ観測が減ったときは J で終わらせない', (g) => {
    const e = g.files[fontKey].calls.inspect_fonts;
    e.raw.observation = { scope: 'T-3' };
    e.raw.fonts.pop();
    e.raw.totalFontCount -= 1;
    refresh(e, 'inspect_fonts');
    return g;
  }, (t) => /^E 観測できた対象が減った/m.test(t) && !/^J 前の版に無かった項目が増えただけ: 1$/m.test(t));

  add('17 kept に無い項目だけ動かす（sha で出る）', (g) => {
    const e = g.files[okKey].calls.inspect_structure;
    e.raw.pageTree.mediaBoxSamples[0].width += 1;
    refresh(e, 'inspect_structure');
    return g;
  }, (t) => /差: [1-9]/.test(t) && /inspect_structure/.test(t));

  return runCases(base, write, cases, missing, goldenPath, format, fileKeys.length);
}

/** markdown の T-3 で render_page の画像を探す（壊す先が無ければ例外を投げて「回らなかった」に落ちる）。 */
function imgKeyOf(g) {
  const k = Object.keys(g.files).find((x) => (g.files[x].calls.render_page?.blocks ?? []).some((b) => b.type === 'image'));
  if (!k) throw new Error('画像を返した検体が集合に無い');
  return k;
}

// --------------------------------------------------------------------------
// CLI —— 🔴 知らない引数では止まる
// --------------------------------------------------------------------------

const USAGE = `使い方:
  node scripts/golden.mjs take <out.json> [--set <dir>]... [--label NAME] [--limit N]
                                          [--resume] [--budget-ms N] [--ref <pdf>]
                                          [--shard k/n] [--format json|markdown]   既定 json
  node scripts/golden.mjs merge <out.json> <shard1.json> <shard2.json>... [--label NAME]
  node scripts/golden.mjs diff <before.json> <after.json> [--detail <file-key>] [--max N]
  node scripts/golden.mjs report <golden.json>
  node scripts/golden.mjs t3   <golden.json>`;

function parseArgs(argv) {
  const positional = [];
  const opts = { sets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') opts.sets.push(argv[++i]);
    else if (a === '--label') opts.label = argv[++i];
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--resume') opts.resume = true;
    else if (a === '--budget-ms') opts.budgetMs = Number(argv[++i]);
    else if (a === '--shard') {
      const m = /^(\d+)\/(\d+)$/.exec(argv[++i] ?? '');
      if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) {
        console.error(`--shard は k/n の形（1 <= k <= n）: ${argv[i]}`);
        process.exit(2);
      }
      opts.shard = { k: Number(m[1]), n: Number(m[2]) };
    }
    else if (a === '--ref') opts.ref = argv[++i];
    else if (a === '--format') opts.format = argv[++i];
    else if (a === '--detail') opts.detail = argv[++i];
    else if (a === '--max') opts.max = Number(argv[++i]);
    else if (a.startsWith('--')) {
      console.error(`知らない引数: ${a}\n${USAGE}`);
      process.exit(2);
    } else positional.push(a);
  }
  return { positional, opts };
}

const { positional, opts } = parseArgs(process.argv.slice(2));
const mode = positional[0];

if (mode === 'take') {
  if (!positional[1]) {
    console.error(USAGE);
    process.exit(2);
  }
  await take(positional[1], opts);
  process.exit(0);
} else if (mode === 'merge') {
  if (positional.length < 3) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exit(merge(positional[1], positional.slice(2), opts));
} else if (mode === 'diff') {
  if (!positional[1] || !positional[2]) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exit(diff(positional[1], positional[2], opts));
} else if (mode === 'report') {
  if (!positional[1]) {
    console.error(USAGE);
    process.exit(2);
  }
  reportAxes(JSON.parse(readFileSync(resolve(positional[1]), 'utf8')), positional[1]);
  process.exit(0);
} else if (mode === 't3') {
  if (!positional[1] || !existsSync(resolve(positional[1]))) {
    console.error(`t3 に渡すゴールデンが無い: ${positional[1] ?? '(指定なし)'}\n` +
      '先に take を 1 回だけ回す（--limit 40 でよい）');
    process.exit(2);
  }
  process.exit(t3(positional[1]));
} else {
  console.error(USAGE);
  process.exit(2);
}
