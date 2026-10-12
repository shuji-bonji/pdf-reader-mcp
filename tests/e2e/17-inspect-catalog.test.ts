/**
 * 17 - inspect_catalog (#27)
 *
 * IC-1〜IC-9: カタログ直下の構成要素を列挙する。
 *
 * 🔴 固定しているのは「無い」と「読めなかった」の区別である。鍵が導けない暗号化文書で
 * 全項目が `absent` になったら、この試験は落ちなければならない（IC-9）。
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyXmpPolicy, inspectCatalog } from '../../src/services/catalog-service.js';
import { collectNamespaces, parseDeclarations } from '../../src/services/xmp-service.js';
import type { ActionInfo, CatalogInventory } from '../../src/types.js';
import { formatCatalogMarkdown } from '../../src/utils/formatter.js';
import { HALVES_SPECIMENS } from './halves-specimens.js';
import { FIXTURES } from './setup.js';

const OPTS = { maxOutlineItems: 50 };

/** 値を持つ項目だけを通す。`absent` / `unreadable` ならテストを落とす。 */
function present<T extends object>(
  entry: T | { status: 'absent' } | { status: 'unreadable'; reason: string },
): T {
  if ('status' in entry) throw new Error(`expected a value, got ${JSON.stringify(entry)}`);
  return entry;
}

describe('17 - inspect_catalog', () => {
  let inv: CatalogInventory;
  beforeAll(async () => {
    inv = await inspectCatalog(FIXTURES.catalogFeatures, OPTS);
  });

  // IC-1: /Outlines — count by walking, depth, targets via /Dest and via a GoTo /A
  it('IC-1: outlines are walked, not trusted from /Count', () => {
    const o = present(inv.outlines);
    expect(o.count).toBe(3);
    expect(o.maxDepth).toBe(2);
    expect(o.items.map((i) => [i.title, i.depth, i.page, i.action])).toEqual([
      ['Chapter 1', 1, 1, null],
      ['Section 1.1', 2, 2, 'GoTo'],
      ['Chapter 2', 1, 2, null],
    ]);
    expect(o.truncated).toBe(false);
  });

  it('IC-1b: max_outline_items caps the list but not the count', async () => {
    const capped = await inspectCatalog(FIXTURES.catalogFeatures, { maxOutlineItems: 1 });
    const o = present(capped.outlines);
    expect(o.count).toBe(3);
    expect(o.items).toHaveLength(1);
    expect(o.truncated).toBe(true);
  });

  // IC-2: /OCProperties
  it('IC-2: optional content groups and the default configuration', () => {
    const oc = present(inv.optionalContent);
    expect(oc.groups.map((g) => g.name)).toEqual(['Base layer', 'Annotations layer']);
    expect(oc.defaultConfig).toEqual({ name: 'Default', baseState: 'ON', on: 0, off: 1 });
    expect(oc.alternateConfigs).toBe(0);
  });

  // IC-3: /Names → /EmbeddedFiles
  it('IC-3: embedded files with name, MIME type, size, AFRelationship', () => {
    const ef = present(inv.embeddedFiles);
    expect(ef.count).toBe(2);
    expect(ef.unreadable).toBe(0);
    expect(ef.files[0]).toEqual({
      key: 'data.csv',
      fileName: 'data.csv',
      mimeType: 'text/csv',
      size: 22,
      afRelationship: 'Data',
      description: 'Source figures',
    });
    // No /Params /Size on this one: the size comes from the decoded stream.
    expect(ef.files[1]).toMatchObject({
      key: 'readme.txt',
      mimeType: 'text/plain',
      size: 6,
      afRelationship: null,
    });
    expect(inv.associatedFiles).toBe(1);
  });

  // IC-4: other name trees — document-level JavaScript is counted
  it('IC-4: /Dests and /JavaScript name trees are counted', () => {
    const names = present(inv.names);
    expect(names).toEqual({ dests: 0, javaScript: 1 });
  });

  // IC-5: /Metadata — declared values, as written
  it('IC-5: XMP declarations: pdfaid, pdfuaid, TDMRep', () => {
    const m = inv.metadata;
    if (m.status !== 'read') throw new Error(`expected read, got ${m.status}`);
    expect(m.subtype).toBe('XML');
    expect(m.namespaces.map((n) => n.prefix)).toContain('tdm');
    expect(m.declarations).toEqual({
      pdfaid: { part: 3, conformance: 'B' },
      pdfuaid: { part: 1 },
      tdm: { reservation: 1, policy: 'https://example.org/tdm-policy' },
    });
    expect(m.xml).toContain('<pdfuaid:part>1</pdfuaid:part>');
  });

  // IC-6: /OpenAction and /AA
  it('IC-6: open action with its /Next chain, and document-level /AA', () => {
    const oa = present(inv.openAction) as ActionInfo;
    expect(oa).toMatchObject({ type: 'GoTo', page: 2, hasJavaScript: false, next: ['JavaScript'] });
    const aa = present(inv.additionalActions) as Record<string, ActionInfo>;
    expect(Object.keys(aa)).toEqual(['WC']);
    expect(aa.WC).toMatchObject({ type: 'JavaScript', hasJavaScript: true, next: [] });
    expect(inv.collection).toBe(false);
  });

  // IC-7: a document without any of these keys reports every entry as absent
  it('IC-7: simple.pdf — every entry is absent, none unreadable', async () => {
    const plain = await inspectCatalog(FIXTURES.simple, OPTS);
    for (const entry of [
      plain.outlines,
      plain.optionalContent,
      plain.embeddedFiles,
      plain.names,
      plain.metadata,
      plain.openAction,
      plain.additionalActions,
    ]) {
      expect(entry).toEqual({ status: 'absent' });
    }
    expect(plain.associatedFiles).toBe(0);
    expect(plain.note).toBeUndefined();
  });

  // IC-8: markdown carries the declared values and the actions
  it('IC-8: markdown rendering; the packet text only with include_xmp', () => {
    const md = formatCatalogMarkdown(applyXmpPolicy(inv, false));
    expect(md).toContain('Chapter 1 → p.1');
    expect(md).toContain('| data.csv | data.csv | text/csv | 22 B | Data | Source figures |');
    expect(md).toContain(
      'TDM reservation (W3C TDMRep, tdm): reservation 1, policy https://example.org/tdm-policy',
    );
    expect(md).toContain('type **GoTo**, page 2, then /Next: JavaScript');
    expect(md).toContain('WC: type **JavaScript**, **carries /JS**');
    // The packet itself is not in the output unless asked for.
    expect(md).not.toContain('<?xpacket');
    const withXmp = applyXmpPolicy(inv, true);
    expect(formatCatalogMarkdown(withXmp)).toContain('<?xpacket');
    expect(JSON.stringify(applyXmpPolicy(inv, false))).not.toContain('xpacket');
    expect(JSON.stringify(withXmp)).toContain('xpacket');
  });

  // IC-9: encrypted, key not derivable → unreadable, never absent
  it('IC-9: a locked-out document reports unreadable, not absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-locked-'));
    const spec = HALVES_SPECIMENS.failOk;
    const bytes = Buffer.from(spec.base64, 'base64');
    expect(createHash('sha256').update(bytes).digest('hex').slice(0, 32)).toBe(spec.sha256);
    const path = join(dir, spec.name);
    writeFileSync(path, bytes);

    const locked = await inspectCatalog(path, OPTS);
    expect(locked.isEncrypted).toBe(true);
    expect(locked.note).toMatch(/key could not be derived/);
    for (const entry of [
      locked.outlines,
      locked.optionalContent,
      locked.embeddedFiles,
      locked.names,
      locked.metadata,
      locked.openAction,
      locked.additionalActions,
    ]) {
      expect(entry).toMatchObject({ status: 'unreadable' });
    }
    expect(locked.associatedFiles).toBeNull();
  });
});

describe('17 - xmp-service', () => {
  it('XS-1: attribute form and element form both read; prefix is looked up by namespace URI', () => {
    const xml = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description xmlns:ua="http://www.aiim.org/pdfua/ns/id/" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
        ua:part="2" pdfaid:part="4"><pdfaid:conformance>F</pdfaid:conformance></rdf:Description></rdf:RDF>`;
    // `ua` is an unusual prefix for the PDF/UA namespace; the URI decides.
    expect(parseDeclarations(xml)).toEqual({
      pdfaid: { part: 4, conformance: 'F' },
      pdfuaid: { part: 2 },
      tdm: null,
    });
    expect(collectNamespaces(xml).map((n) => n.prefix)).toEqual(['rdf', 'ua', 'pdfaid']);
  });

  it('XS-2: tdm:reservation 0 is a value, not an absence', () => {
    const xml = `<r xmlns:tdm="http://www.w3.org/ns/tdmrep#"><tdm:reservation>0</tdm:reservation></r>`;
    expect(parseDeclarations(xml).tdm).toEqual({ reservation: 0, policy: null });
  });

  it('XS-3: a non-integer part is reported as null, not coerced', () => {
    const xml = `<r xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" pdfuaid:part="one"/>`;
    expect(parseDeclarations(xml).pdfuaid).toEqual({ part: null });
  });
});
