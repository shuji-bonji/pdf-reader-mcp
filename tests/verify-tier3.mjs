#!/usr/bin/env node
/**
 * Tier 3 verification via raw stdio JSON-RPC.
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
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

  // ─── validate_tagged (simple.pdf - untagged) ──────
  console.log('\n━━━ validate_tagged (simple.pdf) ━━━');
  {
    const text = getText(
      await callTool('validate_tagged', { file_path: SIMPLE_PDF, response_format: 'json' }),
    );
    if (text.startsWith('Error')) {
      record('validate_tagged', 'JSON parse', false, text.substring(0, 80));
    } else {
      const v = JSON.parse(text);
      record('validate_tagged', 'isTagged=false', v.isTagged === false, `isTagged: ${v.isTagged}`);
      record('validate_tagged', 'has issues', v.issues.length > 0, `${v.issues.length} issue(s)`);
      record('validate_tagged', 'failed > 0', v.failed > 0, `${v.failed} failed`);
      record(
        'validate_tagged',
        'TAG-001 error',
        v.issues.some((i) => i.code === 'TAG-001' && i.severity === 'error'),
        'TAG-001 is error for untagged',
      );
    }
  }
  {
    const text = getText(
      await callTool('validate_tagged', { file_path: SIMPLE_PDF, response_format: 'markdown' }),
    );
    record(
      'validate_tagged',
      'markdown header',
      text.includes('# PDF/UA Tag Validation'),
      'has header',
    );
    record('validate_tagged', 'markdown summary', text.includes('Summary'), 'has summary');
  }

  // ─── validate_tagged (annotated.pdf) ──────────────
  console.log('\n━━━ validate_tagged (annotated.pdf) ━━━');
  {
    const text = getText(
      await callTool('validate_tagged', { file_path: ANNOTATED_PDF, response_format: 'json' }),
    );
    if (text.startsWith('Error')) {
      record('validate_tagged:annotated', 'JSON parse', false, text.substring(0, 80));
    } else {
      const v = JSON.parse(text);
      record(
        'validate_tagged:annotated',
        'totalChecks > 0',
        v.totalChecks > 0,
        `${v.totalChecks} checks`,
      );
      record(
        'validate_tagged:annotated',
        'has summary',
        v.summary.length > 0,
        v.summary.substring(0, 60),
      );
    }
  }

  // ─── validate_metadata (simple.pdf) ────────────────
  console.log('\n━━━ validate_metadata (simple.pdf) ━━━');
  {
    const text = getText(
      await callTool('validate_metadata', { file_path: SIMPLE_PDF, response_format: 'json' }),
    );
    if (text.startsWith('Error')) {
      record('validate_metadata', 'JSON parse', false, text.substring(0, 80));
    } else {
      const m = JSON.parse(text);
      record(
        'validate_metadata',
        'totalChecks=10',
        m.totalChecks === 10,
        `${m.totalChecks} checks`,
      );
      record('validate_metadata', 'has metadata obj', m.metadata !== undefined, 'metadata present');
      record(
        'validate_metadata',
        'pdfVersion detected',
        m.metadata.pdfVersion !== null,
        `version: ${m.metadata.pdfVersion}`,
      );
      record('validate_metadata', 'has issues', m.issues.length > 0, `${m.issues.length} issue(s)`);
      record(
        'validate_metadata',
        'META-001 exists',
        m.issues.some((i) => i.code === 'META-001'),
        'META-001 checked',
      );
    }
  }
  {
    const text = getText(
      await callTool('validate_metadata', { file_path: SIMPLE_PDF, response_format: 'markdown' }),
    );
    record(
      'validate_metadata',
      'markdown header',
      text.includes('# Metadata Validation'),
      'has header',
    );
    record(
      'validate_metadata',
      'markdown field table',
      text.includes('Field Presence'),
      'has field table',
    );
  }

  // ─── validate_metadata (annotated.pdf) ─────────────
  console.log('\n━━━ validate_metadata (annotated.pdf) ━━━');
  {
    const text = getText(
      await callTool('validate_metadata', { file_path: ANNOTATED_PDF, response_format: 'json' }),
    );
    if (text.startsWith('Error')) {
      record('validate_metadata:annotated', 'JSON parse', false, text.substring(0, 80));
    } else {
      const m = JSON.parse(text);
      record(
        'validate_metadata:annotated',
        'totalChecks=10',
        m.totalChecks === 10,
        `${m.totalChecks} checks`,
      );
      record(
        'validate_metadata:annotated',
        'has summary',
        m.summary.length > 0,
        m.summary.substring(0, 60),
      );
    }
  }

  // ─── compare_structure (simple vs annotated) ───────
  console.log('\n━━━ compare_structure (simple vs annotated) ━━━');
  {
    const text = getText(
      await callTool('compare_structure', {
        file_path_1: SIMPLE_PDF,
        file_path_2: ANNOTATED_PDF,
        response_format: 'json',
      }),
    );
    if (text.startsWith('Error')) {
      record('compare_structure', 'JSON parse', false, text.substring(0, 80));
    } else {
      const c = JSON.parse(text);
      record('compare_structure', 'has file1', c.file1 === 'simple.pdf', `file1: ${c.file1}`);
      record('compare_structure', 'has file2', c.file2 === 'annotated.pdf', `file2: ${c.file2}`);
      record(
        'compare_structure',
        'diffs > 0',
        c.diffs.length > 0,
        `${c.diffs.length} properties compared`,
      );
      record(
        'compare_structure',
        'has differences',
        c.diffs.some((d) => d.status === 'differ'),
        'found differences',
      );
      record(
        'compare_structure',
        'fontComparison exists',
        c.fontComparison !== undefined,
        'font comparison present',
      );
      record('compare_structure', 'has summary', c.summary.length > 0, c.summary.substring(0, 60));
    }
  }
  {
    const text = getText(
      await callTool('compare_structure', {
        file_path_1: SIMPLE_PDF,
        file_path_2: ANNOTATED_PDF,
        response_format: 'markdown',
      }),
    );
    record(
      'compare_structure',
      'markdown header',
      text.includes('# PDF Structure Comparison'),
      'has header',
    );
    record(
      'compare_structure',
      'markdown table',
      text.includes('Property Comparison'),
      'has comparison table',
    );
    record(
      'compare_structure',
      'markdown fonts',
      text.includes('Font Comparison'),
      'has font section',
    );
  }

  // ─── compare_structure (same file) ─────────────────
  console.log('\n━━━ compare_structure (same file) ━━━');
  {
    const text = getText(
      await callTool('compare_structure', {
        file_path_1: SIMPLE_PDF,
        file_path_2: SIMPLE_PDF,
        response_format: 'json',
      }),
    );
    if (text.startsWith('Error')) {
      record('compare_structure:same', 'JSON parse', false, text.substring(0, 80));
    } else {
      const c = JSON.parse(text);
      const allMatch = c.diffs.every((d) => d.status === 'match');
      record(
        'compare_structure:same',
        'all match',
        allMatch,
        `${c.diffs.filter((d) => d.status === 'match').length}/${c.diffs.length} match`,
      );
    }
  }

  // ─── Error cases ───────────────────────────────────
  console.log('\n━━━ Error cases ━━━');
  {
    const text = getText(await callTool('validate_tagged', { file_path: '/nonexistent.pdf' }));
    record('error', 'nonexistent (validate_tagged)', text.includes('Error'), text.substring(0, 60));
  }
  {
    const text = getText(await callTool('validate_metadata', { file_path: '/nonexistent.pdf' }));
    record(
      'error',
      'nonexistent (validate_metadata)',
      text.includes('Error'),
      text.substring(0, 60),
    );
  }
  {
    const text = getText(
      await callTool('compare_structure', {
        file_path_1: '/nonexistent.pdf',
        file_path_2: SIMPLE_PDF,
      }),
    );
    record(
      'error',
      'nonexistent (compare_structure)',
      text.includes('Error'),
      text.substring(0, 60),
    );
  }

  // ─── Summary ───────────────────────────────────────
  server.stdin.end();
  server.kill();

  console.log(`\n${'═'.repeat(60)}`);
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n📊 Tier 3 Results: ${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`   [${r.tool}] ${r.scenario}: ${r.detail}`);
    }
  } else {
    console.log('\n🎉 All Tier 3 tools verified successfully!');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
