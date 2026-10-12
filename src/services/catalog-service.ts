/**
 * 文書レベルの目録を読む（`inspect_catalog`、#27）。
 *
 * カタログ辞書（ISO 32000-2 §7.7.2 Table 29）の直下にあって、ページの中身ではない
 * 構成要素 —— ブックマーク（`/Outlines` §12.3.3）・レイヤー（`/OCProperties` §8.11.4）・
 * 添付ファイル（`/Names` → `/EmbeddedFiles` §7.7.4 / §7.11.4）・XMP（`/Metadata` §14.3.2）・
 * 開いたときに走るアクション（`/OpenAction`・`/AA` §12.6.3 Table 200）—— を 1 回で列挙する。
 *
 * `inspect_structure` は同じカタログのキーの一覧を COS 型付きで返すが、値の中へは
 * 入らない。ここは中へ入って「何があるか」を数える。
 *
 * 🔴 判定は書かない。添付が PDF/A か、アクションが危険か、`tdm:reservation` に従うべきかは
 * ここでは言わない（pdf-verify-mcp と呼び出し側の責務）。
 *
 * 🔴 「無い」と「読めなかった」を分ける。キーが無いことは観測できた事実（`absent`）で、
 * キーはあるが値に届かないのは観測できなかったこと（`unreadable`）である。
 * 両方を `null` に畳むと、鍵が導けない暗号化文書が「添付もブックマークも無い文書」の顔をする。
 */

import {
  asArray,
  asDict,
  asRef,
  decodedBytes,
  get,
  integerOf,
  nameOf,
  refKey,
  resolved,
  textOf,
  tryGet,
  tryResolve,
} from '@normativepdf/recover';
import type { CosDict, CosObject, PdfDocument } from 'normativepdf';
import { readPageTree } from 'normativepdf';
import type {
  ActionInfo,
  CatalogInventory,
  EmbeddedFileInfo,
  EmbeddedFilesInfo,
  NameTreesInfo,
  OptionalContentInfo,
  OutlineItemInfo,
  OutlinesInfo,
} from '../types.js';
import { lockedOut, openPdf } from './recover-service.js';
import { readXmpMetadata, XMP_RETURN_LIMIT } from './xmp-service.js';

type Absent = { status: 'absent' };
type Unreadable = { status: 'unreadable'; reason: string };

const ABSENT: Absent = { status: 'absent' };

/** 鍵が導けなかった文書に付ける 1 文。数はすべて「見えなかった」であって「無い」ではない。 */
const LOCKED_OUT_NOTE =
  'The document is encrypted and the key could not be derived from the empty user password ' +
  '(ISO 32000-2 §7.6.4.3.2), so the catalog could not be read. Every entry below is reported as ' +
  'unreadable, not as absent.';

/** 読み手を壊さないための上限。`/Next` の環や巨大な名前ツリーで止まらないようにする。 */
const MAX_OUTLINE_WALK = 10_000;
const MAX_EMBEDDED_FILES = 500;
const MAX_NEXT_CHAIN = 64;

export interface InspectCatalogOptions {
  /** 返す outline 項目の上限（数え上げは全件行う）。 */
  maxOutlineItems: number;
}

export async function inspectCatalog(
  filePath: string,
  options: InspectCatalogOptions,
): Promise<CatalogInventory> {
  const { doc, scope } = await openPdf(filePath);
  const locked = lockedOut(scope);
  const catalog = locked ? null : asDict(await doc.getCatalog().catch(() => null));

  if (!catalog) {
    const reason = locked
      ? 'encrypted; key not derivable'
      : 'the catalog dictionary could not be read';
    const unreadable: Unreadable = { status: 'unreadable', reason };
    return {
      outlines: unreadable,
      optionalContent: unreadable,
      embeddedFiles: unreadable,
      associatedFiles: null,
      names: unreadable,
      metadata: unreadable,
      openAction: unreadable,
      additionalActions: unreadable,
      collection: false,
      isEncrypted: scope.encrypted,
      note: locked
        ? LOCKED_OUT_NOTE
        : 'The catalog dictionary could not be read (ISO 32000-2 §7.7.2).',
    };
  }

  // 宛先 → ページ番号の対応表。ページ木が歩けなければ空で、宛先は解決されずに残る。
  const pageIndex = await buildPageIndex(doc);

  const [outlines, optionalContent, namesDict, metadata, openAction, additionalActions] =
    await Promise.all([
      readOutlines(doc, catalog, pageIndex, options.maxOutlineItems),
      readOptionalContent(doc, catalog),
      lookupDict(doc, catalog, 'Names'),
      readXmpMetadata(doc, catalog),
      readOpenAction(doc, catalog, pageIndex),
      readAdditionalActions(doc, catalog, pageIndex),
    ]);

  let embeddedFiles: EmbeddedFilesInfo | Absent | Unreadable;
  let names: NameTreesInfo | Absent | Unreadable;
  if ('status' in namesDict) {
    embeddedFiles = namesDict;
    names = namesDict;
  } else {
    embeddedFiles = await readEmbeddedFiles(doc, namesDict.value);
    names = {
      dests: await countNameTree(doc, namesDict.value, 'Dests'),
      javaScript: await countNameTree(doc, namesDict.value, 'JavaScript'),
    };
  }

  const af = asArray(await resolved(doc, get(catalog, 'AF')));

  return {
    outlines,
    optionalContent,
    embeddedFiles,
    associatedFiles: catalog.entries.has('AF') ? (af ? af.items.length : null) : 0,
    names,
    metadata: metadata ?? ABSENT,
    openAction,
    additionalActions,
    collection: catalog.entries.has('Collection'),
    isEncrypted: scope.encrypted,
  };
}

/**
 * XMP パケット本文は、頼まれたときだけ・上限付きで返す。宣言値は常に残す
 * （パケットを読む理由がそれだから）。
 */
export function applyXmpPolicy(inventory: CatalogInventory, includeXmp: boolean): CatalogInventory {
  const m = inventory.metadata;
  if (m.status !== 'read') return inventory;
  const { xml, ...rest } = m;
  if (!includeXmp || xml === undefined) return { ...inventory, metadata: rest };
  const capped =
    xml.length > XMP_RETURN_LIMIT
      ? `${xml.slice(0, XMP_RETURN_LIMIT)}\n<!-- truncated at ${XMP_RETURN_LIMIT} characters -->`
      : xml;
  return { ...inventory, metadata: { ...rest, xml: capped } };
}

// ─── shared ────────────────────────────────────────────────────────────────────

/** キーを引いて辞書に解決する。無い・読めない・辞書でないを分けて返す。 */
async function lookupDict(
  doc: PdfDocument,
  dict: CosDict,
  key: string,
): Promise<{ value: CosDict } | Absent | Unreadable> {
  if (!dict.entries.has(key)) return ABSENT;
  const lookup = await tryGet(doc, dict, key);
  if (lookup.unreadable) {
    return { status: 'unreadable', reason: `the /${key} reference could not be resolved` };
  }
  const value = asDict(lookup.value);
  if (!value) {
    return {
      status: 'unreadable',
      reason: `/${key} is ${lookup.value ? `a ${lookup.value.kind}` : 'null'}, not a dictionary`,
    };
  }
  return { value };
}

/** `12 0 R` → 1 始まりのページ番号。 */
async function buildPageIndex(doc: PdfDocument): Promise<Map<string, number>> {
  const index = new Map<string, number>();
  const tree = await readPageTree(doc).catch(() => null);
  if (!tree?.reached) return index;
  for (const page of tree.pages) {
    if (page.ref) index.set(refKey(page.ref), page.index + 1);
  }
  return index;
}

/**
 * 宛先（§12.3.2）からページ番号を引く。配列の先頭がページへの参照なら解決する。
 * 整数（Remote Go-To のページ番号）や名前付き宛先はここでは解決しない。
 */
function pageOfDestination(dest: CosObject | null, pageIndex: Map<string, number>): number | null {
  const array = asArray(dest);
  if (!array || array.items.length === 0) return null;
  const ref = asRef(array.items[0]);
  return ref ? (pageIndex.get(refKey(ref)) ?? null) : null;
}

/** 名前付き宛先（文字列または名前）をそのまま返す。 */
function namedDestination(dest: CosObject | null): string | null {
  if (!dest) return null;
  if (dest.kind === 'name') return dest.value;
  if (dest.kind === 'string') return textOf(dest);
  return null;
}

// ─── /Outlines (§12.3.3) ─────────────────────────────────────────────────────

async function readOutlines(
  doc: PdfDocument,
  catalog: CosDict,
  pageIndex: Map<string, number>,
  maxItems: number,
): Promise<OutlinesInfo | Absent | Unreadable> {
  const root = await lookupDict(doc, catalog, 'Outlines');
  if ('status' in root) return root;

  const items: OutlineItemInfo[] = [];
  let count = 0;
  let maxDepth = 0;
  const seen = new Set<string>();

  // 深さ優先・文書順。`/First` で降り、`/Next` で進む。環は `seen` で切る。
  const walk = async (first: CosObject | undefined, depth: number): Promise<void> => {
    let current = await tryResolve(doc, first);
    while (current.value && count < MAX_OUTLINE_WALK) {
      const ref = asRef(first);
      const node = asDict(current.value);
      if (!node) break;
      const key = ref ? refKey(ref) : null;
      if (key) {
        if (seen.has(key)) break;
        seen.add(key);
      }
      count++;
      if (depth > maxDepth) maxDepth = depth;
      if (items.length < maxItems) {
        items.push(await describeOutlineItem(doc, node, depth, pageIndex));
      }
      if (node.entries.has('First')) await walk(get(node, 'First'), depth + 1);
      first = get(node, 'Next');
      current = await tryResolve(doc, first);
    }
  };
  await walk(get(root.value, 'First'), 1);

  return { count, maxDepth, items, truncated: count > items.length };
}

async function describeOutlineItem(
  doc: PdfDocument,
  node: CosDict,
  depth: number,
  pageIndex: Map<string, number>,
): Promise<OutlineItemInfo> {
  const title = textOf(await resolved(doc, get(node, 'Title')));
  const item: OutlineItemInfo = { title, depth, page: null, named: null, action: null };

  if (node.entries.has('Dest')) {
    const dest = await resolved(doc, get(node, 'Dest'));
    item.page = pageOfDestination(dest, pageIndex);
    item.named = namedDestination(dest);
  } else if (node.entries.has('A')) {
    const action = asDict(await resolved(doc, get(node, 'A')));
    item.action = nameOf(get(action, 'S'));
    if (action && item.action === 'GoTo') {
      const dest = await resolved(doc, get(action, 'D'));
      item.page = pageOfDestination(dest, pageIndex);
      item.named = namedDestination(dest);
    }
  }
  return item;
}

// ─── /OCProperties (§8.11.4) ─────────────────────────────────────────────────

async function readOptionalContent(
  doc: PdfDocument,
  catalog: CosDict,
): Promise<OptionalContentInfo | Absent | Unreadable> {
  const props = await lookupDict(doc, catalog, 'OCProperties');
  if ('status' in props) return props;

  const groups: OptionalContentInfo['groups'] = [];
  const ocgs = asArray(await resolved(doc, get(props.value, 'OCGs')));
  for (const item of ocgs?.items ?? []) {
    const ref = asRef(item);
    const group = asDict(await resolved(doc, item));
    groups.push({
      name: textOf(await resolved(doc, get(group, 'Name'))),
      ref: ref ? refKey(ref) : null,
    });
  }

  let defaultConfig: OptionalContentInfo['defaultConfig'] = null;
  const d = asDict(await resolved(doc, get(props.value, 'D')));
  if (d) {
    const baseState = nameOf(await resolved(doc, get(d, 'BaseState')));
    defaultConfig = {
      name: textOf(await resolved(doc, get(d, 'Name'))),
      baseState:
        baseState === 'ON' || baseState === 'OFF' || baseState === 'Unchanged' ? baseState : null,
      on: asArray(await resolved(doc, get(d, 'ON')))?.items.length ?? 0,
      off: asArray(await resolved(doc, get(d, 'OFF')))?.items.length ?? 0,
    };
  }

  const configs = asArray(await resolved(doc, get(props.value, 'Configs')));
  return { groups, defaultConfig, alternateConfigs: configs?.items.length ?? 0 };
}

// ─── /Names (§7.7.4) ─────────────────────────────────────────────────────────

/**
 * 名前ツリー（§7.9.6）の葉を文書順に集める。`/Kids` で降り、`/Names` の
 * [key value key value ...] を拾う。
 */
async function collectNameTreeLeaves(
  doc: PdfDocument,
  root: CosDict,
  limit: number,
): Promise<{ leaves: { key: string; value: CosObject | undefined }[]; unreadable: number }> {
  const leaves: { key: string; value: CosObject | undefined }[] = [];
  let unreadable = 0;
  const seen = new Set<string>();

  const visit = async (nodeRef: CosObject | undefined, node: CosDict | null): Promise<void> => {
    if (!node || leaves.length >= limit) return;
    const ref = asRef(nodeRef);
    if (ref) {
      const key = refKey(ref);
      if (seen.has(key)) return;
      seen.add(key);
    }
    const names = asArray(await resolved(doc, get(node, 'Names')));
    if (names) {
      for (let i = 0; i + 1 < names.items.length && leaves.length < limit; i += 2) {
        const key = textOf(await resolved(doc, names.items[i]));
        if (key === null) {
          unreadable++;
          continue;
        }
        leaves.push({ key, value: names.items[i + 1] });
      }
    }
    const kids = asArray(await resolved(doc, get(node, 'Kids')));
    for (const kid of kids?.items ?? []) {
      const lookup = await tryResolve(doc, kid);
      if (lookup.unreadable) {
        unreadable++;
        continue;
      }
      await visit(kid, asDict(lookup.value));
    }
  };
  await visit(undefined, root);
  return { leaves, unreadable };
}

async function readEmbeddedFiles(
  doc: PdfDocument,
  names: CosDict,
): Promise<EmbeddedFilesInfo | Absent | Unreadable> {
  const tree = await lookupDict(doc, names, 'EmbeddedFiles');
  if ('status' in tree) return tree;

  const { leaves, unreadable } = await collectNameTreeLeaves(doc, tree.value, MAX_EMBEDDED_FILES);
  const files: EmbeddedFileInfo[] = [];
  let unreadableSpecs = unreadable;

  for (const leaf of leaves) {
    const lookup = await tryResolve(doc, leaf.value);
    const spec = asDict(lookup.value);
    if (lookup.unreadable || !spec) {
      unreadableSpecs++;
      continue;
    }
    files.push(await describeFileSpec(doc, leaf.key, spec));
  }
  return { count: files.length + unreadableSpecs, files, unreadable: unreadableSpecs };
}

/** ファイル指定辞書（Table 43）と埋め込みファイルストリーム（§7.11.4）を読む。 */
async function describeFileSpec(
  doc: PdfDocument,
  key: string,
  spec: CosDict,
): Promise<EmbeddedFileInfo> {
  // §7.11.3: 読み手は `/UF` があればそれを `/F` より優先する。
  const fileName =
    textOf(await resolved(doc, get(spec, 'UF'))) ?? textOf(await resolved(doc, get(spec, 'F')));
  const description = textOf(await resolved(doc, get(spec, 'Desc')));
  const afRelationship = nameOf(await resolved(doc, get(spec, 'AFRelationship')));

  let mimeType: string | null = null;
  let size: number | null = null;
  const ef = asDict(await resolved(doc, get(spec, 'EF')));
  const streamObj =
    (await resolved(doc, get(ef, 'UF'))) ?? (await resolved(doc, get(ef, 'F'))) ?? null;
  if (streamObj?.kind === 'stream') {
    mimeType = nameOf(get(streamObj.dict, 'Subtype'));
    const params = asDict(await resolved(doc, get(streamObj.dict, 'Params')));
    size = integerOf(await resolved(doc, get(params, 'Size')));
    if (size === null) {
      const { bytes } = await decodedBytes(doc, streamObj);
      size = bytes ? bytes.length : null;
    }
  }
  return { key, fileName, mimeType, size, afRelationship, description };
}

/** 名前ツリーの葉の数。キーが無ければ 0、読めなければ null。 */
async function countNameTree(
  doc: PdfDocument,
  names: CosDict,
  key: string,
): Promise<number | null> {
  const tree = await lookupDict(doc, names, key);
  if ('status' in tree) return tree.status === 'absent' ? 0 : null;
  const { leaves } = await collectNameTreeLeaves(doc, tree.value, MAX_OUTLINE_WALK);
  return leaves.length;
}

// ─── /OpenAction and /AA (§7.7.2, §12.6) ─────────────────────────────────────

async function readOpenAction(
  doc: PdfDocument,
  catalog: CosDict,
  pageIndex: Map<string, number>,
): Promise<ActionInfo | Absent | Unreadable> {
  if (!catalog.entries.has('OpenAction')) return ABSENT;
  const lookup = await tryGet(doc, catalog, 'OpenAction');
  if (lookup.unreadable) {
    return { status: 'unreadable', reason: 'the /OpenAction reference could not be resolved' };
  }
  return describeActionOrDestination(doc, lookup.value, pageIndex);
}

async function readAdditionalActions(
  doc: PdfDocument,
  catalog: CosDict,
  pageIndex: Map<string, number>,
): Promise<Record<string, ActionInfo> | Absent | Unreadable> {
  const aa = await lookupDict(doc, catalog, 'AA');
  if ('status' in aa) return aa;
  const result: Record<string, ActionInfo> = {};
  for (const [trigger, value] of aa.value.entries) {
    const described = await describeActionOrDestination(doc, await resolved(doc, value), pageIndex);
    if (!('status' in described)) result[trigger] = described;
  }
  return result;
}

/**
 * アクション辞書（§12.6.2）か明示的な宛先（§12.3.2）を、同じ形で記述する。
 * `/OpenAction` はどちらでもよい（Table 29）。
 */
async function describeActionOrDestination(
  doc: PdfDocument,
  value: CosObject | null,
  pageIndex: Map<string, number>,
): Promise<ActionInfo | Unreadable> {
  if (!value) return { status: 'unreadable', reason: 'the value is null' };
  if (value.kind === 'array' || value.kind === 'name' || value.kind === 'string') {
    return {
      type: 'Destination',
      page: pageOfDestination(value, pageIndex),
      file: null,
      uri: null,
      named: namedDestination(value),
      hasJavaScript: false,
      next: [],
    };
  }
  const action = asDict(value);
  if (!action)
    return {
      status: 'unreadable',
      reason: `a ${value.kind} is neither an action nor a destination`,
    };

  const type = nameOf(await resolved(doc, get(action, 'S'))) ?? 'unknown';
  const info: ActionInfo = {
    type,
    page: null,
    file: null,
    uri: null,
    named: null,
    hasJavaScript: action.entries.has('JS'),
    next: await nextChainTypes(doc, action),
  };
  if (type === 'GoTo') {
    const dest = await resolved(doc, get(action, 'D'));
    info.page = pageOfDestination(dest, pageIndex);
    info.named = namedDestination(dest);
  }
  if (action.entries.has('F')) {
    const f = await resolved(doc, get(action, 'F'));
    const spec = asDict(f);
    info.file = spec
      ? (textOf(await resolved(doc, get(spec, 'UF'))) ??
        textOf(await resolved(doc, get(spec, 'F'))))
      : textOf(f);
  }
  if (type === 'URI') {
    const uri = await resolved(doc, get(action, 'URI'));
    info.uri = uri?.kind === 'string' ? new TextDecoder('latin1').decode(uri.bytes) : null;
  }
  return info;
}

/**
 * `/Next`（§12.6.2）に続くアクションの `/S` を順に集める。辞書なら 1 本、配列ならその要素。
 * 配列の要素それぞれにも `/Next` が付きうるので、上限まで深さ優先で追う。
 */
async function nextChainTypes(doc: PdfDocument, action: CosDict): Promise<string[]> {
  const types: string[] = [];
  const seen = new Set<CosDict>([action]);
  const follow = async (from: CosDict): Promise<void> => {
    const next = await resolved(doc, get(from, 'Next'));
    if (!next || types.length >= MAX_NEXT_CHAIN) return;
    const list = asArray(next)?.items ?? [next];
    for (const item of list) {
      const dict = asDict(await resolved(doc, item));
      if (!dict || seen.has(dict) || types.length >= MAX_NEXT_CHAIN) continue;
      seen.add(dict);
      types.push(nameOf(await resolved(doc, get(dict, 'S'))) ?? 'unknown');
      await follow(dict);
    }
  };
  await follow(action);
  return types;
}
