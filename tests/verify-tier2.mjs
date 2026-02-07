#!/usr/bin/env node
/**
 * Tier 2 verification via raw stdio JSON-RPC.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIMPLE_PDF = resolve(__dirname, 'fixtures/simple.pdf');
const ANNOTATED_PDF = resolve(__dirname, 'fixtures/annotated.pdf');

const results = [];
function record(tool, scenario, passed, detail) {
  results.push({ tool, scenario, passed, detail });
  console.log(`${passed ? '✅' : '❌'} [${tool}] ${scenario}: ${detail}`);
}

const server = spawn('node', [resolve(__dirname, '../dist/index.js')], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = '';
const pending = new Map();
let nextId = 0;

server.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      /* skip non-JSON */
    }
  }
});

function send(method, params) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    const msg = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
    server.stdin.write(msg);
  });
}

function callTool(name, args) {
  return send('tools/call', { name, arguments: args });
}

function getText(response) {
  return response?.result?.content?.[0]?.text ?? '';
}

async function main() {
  await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.1.0' },
  });
  server.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
  );

  // ─── inspect_structure ───────────────────────
  console.log('\n━━━ inspect_structure ━━━');
  {
    const text = getText(
      await callTool('inspect_structure', { file_path: SIMPLE_PDF, response_format: 'json' }),
    );
    if (text.startsWith('Error')) {
      record('inspect_structure', 'JSON parse', false, text.substring(0, 80));
    } else {
      const s = JSON.parse(text);
      record(
        'inspect_structure',
        'catalog entries',
        s.catalog.length > 0,
        `${s.catalog.length} entries`,
      );
      record(
        'inspect_structure',
        'totalPages=3',
        s.pageTree.totalPages === 3,
        `got ${s.pageTree.totalPages}`,
      );
      record(
        'inspect_structure',
        'objects > 0',
        s.objectStats.totalObjects > 0,
        `${s.objectStats.totalObjects} objects`,
      );
      record('inspect_structure', 'isEncrypted', s.isEncrypted === false, `${s.isEncrypted}`);
    }
  }
  {
    const text = getText(
      await callTool('inspect_structure', { file_path: SIMPLE_PDF, response_format: 'markdown' }),
    );
    record('inspect_structure', 'markdown header', text.includes('# PDF Structure Analysis'), 'OK');
    record('inspect_structure', 'markdown catalog', text.includes('Catalog Entries'), 'OK');
  }

  // ─── inspect_tags ──────────────────────────
  console.log('\n━━━ inspect_tags ━━━');
  {
    const text = getText(
      await callTool('inspect_tags', { file_path: SIMPLE_PDF, response_format: 'json' }),
    );
    if (text.startsWith('Error')) {
      record('inspect_tags', 'JSON parse', false, text.substring(0, 80));
    } else {
      const t = JSON.parse(text);
      record('inspect_tags', 'isTagged=false', t.isTagged === false, 'simple.pdf is untagged');
      record('inspect_tags', 'rootTag=null', t.rootTag === null, 'no tag tree');
      record('inspect_tags', 'totalElements=0', t.totalElements === 0, `${t.totalElements}`);
    }
  }
  {
    const text = getText(
      await callTool('inspect_tags', { file_path: SIMPLE_PDF, response_format: 'markdown' }),
    );
    record('inspect_tags', 'markdown untagged', text.includes('not tagged'), 'shows notice');
  }

  // ─── inspect_fonts ─────────────────────────
  console.log('\n━━━ inspect_fonts ━━━');
  {
    const text = getText(
      await callTool('inspect_fonts', { file_path: SIMPLE_PDF, response_format: 'json' }),
    );
    if (text.startsWith('Error')) {
      record('inspect_fonts', 'JSON parse', false, text.substring(0, 80));
    } else {
      const f = JSON.parse(text);
      record(
        'inspect_fonts',
        'totalFontCount > 0',
        f.totalFontCount > 0,
        `${f.totalFontCount} fonts`,
      );
      if (f.fonts.length > 0) {
        record('inspect_fonts', 'font has name', f.fonts[0].name.length > 0, f.fonts[0].name);
        record('inspect_fonts', 'font has type', f.fonts[0].type.length > 0, f.fonts[0].type);
      }
    }
  }
  {
    const text = getText(
      await callTool('inspect_fonts', { file_path: SIMPLE_PDF, response_format: 'markdown' }),
    );
    record('inspect_fonts', 'markdown header', text.includes('# Font Analysis'), 'OK');
  }

  // ─── inspect_annotations ───────────────────
  console.log('\n━━━ inspect_annotations ━━━');
  {
    const text = getText(
      await callTool('inspect_annotations', { file_path: SIMPLE_PDF, response_format: 'json' }),
    );
    if (text.startsWith('Error')) {
      record('inspect_annotations', 'JSON parse', false, text.substring(0, 80));
    } else {
      const a = JSON.parse(text);
      record(
        'inspect_annotations',
        'totalAnnotations=0',
        a.totalAnnotations === 0,
        `${a.totalAnnotations}`,
      );
      record('inspect_annotations', 'hasLinks=false', a.hasLinks === false, 'no links');
      record('inspect_annotations', 'hasForms=false', a.hasForms === false, 'no forms');
    }
  }
  {
    const text = getText(
      await callTool('inspect_annotations', { file_path: SIMPLE_PDF, response_format: 'markdown' }),
    );
    record(
      'inspect_annotations',
      'markdown no-annot',
      text.includes('No annotations'),
      'shows notice',
    );
  }

  // ─── inspect_signatures ────────────────────
  console.log('\n━━━ inspect_signatures ━━━');
  {
    const text = getText(
      await callTool('inspect_signatures', { file_path: SIMPLE_PDF, response_format: 'json' }),
    );
    if (text.startsWith('Error')) {
      record('inspect_signatures', 'JSON parse', false, text.substring(0, 80));
    } else {
      const sig = JSON.parse(text);
      record('inspect_signatures', 'totalFields=0', sig.totalFields === 0, `${sig.totalFields}`);
      record(
        'inspect_signatures',
        'has note',
        sig.note.includes('No AcroForm'),
        'no AcroForm notice',
      );
    }
  }
  {
    const text = getText(
      await callTool('inspect_signatures', { file_path: SIMPLE_PDF, response_format: 'markdown' }),
    );
    record(
      'inspect_signatures',
      'markdown no-sig',
      text.includes('No signature fields'),
      'shows notice',
    );
  }

  // ─── annotated.pdf: annotations ───────────
  console.log('\n━━━ annotated.pdf: annotations ━━━');
  {
    const text = getText(
      await callTool('inspect_annotations', {
        file_path: ANNOTATED_PDF,
        response_format: 'json',
      }),
    );
    if (text.startsWith('Error')) {
      record('annotated:annotations', 'JSON parse', false, text.substring(0, 80));
    } else {
      const a = JSON.parse(text);
      record(
        'annotated:annotations',
        'has annotations',
        a.totalAnnotations > 0,
        `${a.totalAnnotations} annotations`,
      );
      record('annotated:annotations', 'hasLinks', a.hasLinks === true, 'has links');
    }
  }

  // ─── annotated.pdf: signatures ──────────
  console.log('\n━━━ annotated.pdf: signatures ━━━');
  {
    const text = getText(
      await callTool('inspect_signatures', {
        file_path: ANNOTATED_PDF,
        response_format: 'json',
      }),
    );
    if (text.startsWith('Error')) {
      record('annotated:signatures', 'JSON parse', false, text.substring(0, 80));
    } else {
      const sig = JSON.parse(text);
      record(
        'annotated:signatures',
        'has sig field',
        sig.totalFields > 0,
        `${sig.totalFields} field(s)`,
      );
      record(
        'annotated:signatures',
        'unsigned field',
        sig.unsignedCount > 0,
        `${sig.unsignedCount} unsigned`,
      );
    }
  }

  // ─── annotated.pdf: fonts ───────────────
  console.log('\n━━━ annotated.pdf: fonts ━━━');
  {
    const text = getText(
      await callTool('inspect_fonts', {
        file_path: ANNOTATED_PDF,
        response_format: 'json',
      }),
    );
    if (text.startsWith('Error')) {
      record('annotated:fonts', 'JSON parse', false, text.substring(0, 80));
    } else {
      const f = JSON.parse(text);
      record(
        'annotated:fonts',
        'multiple fonts',
        f.totalFontCount >= 3,
        `${f.totalFontCount} fonts`,
      );
      record(
        'annotated:fonts',
        'pagesScanned=2',
        f.pagesScanned === 2,
        `scanned ${f.pagesScanned}`,
      );
    }
  }

  // ─── annotated.pdf: structure ───────────
  console.log('\n━━━ annotated.pdf: structure ━━━');
  {
    const text = getText(
      await callTool('inspect_structure', {
        file_path: ANNOTATED_PDF,
        response_format: 'json',
      }),
    );
    if (text.startsWith('Error')) {
      record('annotated:structure', 'JSON parse', false, text.substring(0, 80));
    } else {
      const s = JSON.parse(text);
      record(
        'annotated:structure',
        'pdfVersion',
        s.pdfVersion !== null,
        `version: ${s.pdfVersion}`,
      );
      record(
        'annotated:structure',
        'has AcroForm in catalog',
        s.catalog.some((e) => e.key === 'AcroForm'),
        'AcroForm present',
      );
    }
  }

  // ─── Error case ────────────────────────────
  console.log('\n━━━ Error cases ━━━');
  {
    const text = getText(await callTool('inspect_structure', { file_path: '/nonexistent.pdf' }));
    record('error', 'nonexistent file', text.includes('Error'), text.substring(0, 60));
  }

  // ─── Summary ───────────────────────────────
  server.stdin.end();
  server.kill();

  console.log(`\n${'═'.repeat(60)}`);
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n📊 Tier 2 Results: ${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`   [${r.tool}] ${r.scenario}: ${r.detail}`);
    }
  } else {
    console.log('\n🎉 All Tier 2 tools verified successfully!');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
