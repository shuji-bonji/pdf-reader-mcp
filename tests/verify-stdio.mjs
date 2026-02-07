#!/usr/bin/env node
/**
 * Tier 1 full verification via raw stdio JSON-RPC.
 * No tsx dependency needed - runs with plain Node.js.
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIMPLE_PDF = resolve(__dirname, 'fixtures/simple.pdf');
const EMPTY_PDF = resolve(__dirname, 'fixtures/empty.pdf');

const results = [];
function record(tool, scenario, passed, detail) {
  results.push({ tool, scenario, passed, detail });
  console.log(`${passed ? '✅' : '❌'} [${tool}] ${scenario}: ${detail}`);
}

// Start MCP server
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

function sendNotification(method, params) {
  const msg = `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`;
  server.stdin.write(msg);
}

function callTool(name, args) {
  return send('tools/call', { name, arguments: args });
}

function getText(response) {
  return response?.result?.content?.[0]?.text ?? '';
}

async function main() {
  // Initialize
  await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.1.0' },
  });
  sendNotification('notifications/initialized');

  // List tools
  const toolsResp = await send('tools/list', {});
  const toolCount = toolsResp.result.tools.length;
  record('server', `registered ${toolCount} tools`, toolCount === 12, `expected 12`);

  // ─── 1. get_page_count ─────────────────────────
  console.log('\n━━━ 1. get_page_count ━━━');
  {
    const text = getText(await callTool('get_page_count', { file_path: SIMPLE_PDF }));
    record('get_page_count', 'simple.pdf → 3', text === '3', `got: ${text}`);
  }
  {
    const text = getText(await callTool('get_page_count', { file_path: EMPTY_PDF }));
    record('get_page_count', 'empty.pdf → 1', text === '1', `got: ${text}`);
  }

  // ─── 2. get_metadata ───────────────────────────
  console.log('\n━━━ 2. get_metadata ━━━');
  {
    const text = getText(
      await callTool('get_metadata', { file_path: SIMPLE_PDF, response_format: 'json' }),
    );
    const m = JSON.parse(text);
    record('get_metadata', 'title', m.title === 'Test PDF Document', `"${m.title}"`);
    record('get_metadata', 'author', m.author === 'pdf-reader-mcp', `"${m.author}"`);
    record('get_metadata', 'pageCount', m.pageCount === 3, `${m.pageCount}`);
    record('get_metadata', 'isTagged=false', m.isTagged === false, `${m.isTagged}`);
    record('get_metadata', 'fileSize > 0', m.fileSize > 0, `${m.fileSize}`);
  }
  {
    const text = getText(
      await callTool('get_metadata', { file_path: SIMPLE_PDF, response_format: 'markdown' }),
    );
    record('get_metadata', 'markdown header', text.includes('# PDF Metadata'), 'OK');
    record('get_metadata', 'markdown title', text.includes('Test PDF Document'), 'OK');
  }

  // ─── 3. read_text ──────────────────────────────
  console.log('\n━━━ 3. read_text ━━━');
  {
    const text = getText(await callTool('read_text', { file_path: SIMPLE_PDF, pages: '1' }));
    record('read_text', 'page 1: title', text.includes('Hello PDF World'), 'found');
    record('read_text', 'page 1: body', text.includes('test PDF document'), 'found');
  }
  {
    const text = getText(
      await callTool('read_text', { file_path: SIMPLE_PDF, pages: '2-3', response_format: 'json' }),
    );
    const pages = JSON.parse(text);
    record('read_text', 'pages 2-3: count', pages.length === 2, `${pages.length} pages`);
    record('read_text', 'page 2 content', pages[0].text.includes('Page Two'), 'found');
    record('read_text', 'page 3 content', pages[1].text.includes('Page Three'), 'found');
  }
  {
    const text = getText(await callTool('read_text', { file_path: SIMPLE_PDF, pages: '1,3' }));
    record(
      'read_text',
      'comma pages: 1,3',
      text.includes('Hello PDF World') && text.includes('Page Three'),
      'both found',
    );
  }
  {
    const text = getText(await callTool('read_text', { file_path: EMPTY_PDF }));
    const contentLen = text.replace(/^##.*/gm, '').trim().length;
    record('read_text', 'empty.pdf: no text', contentLen < 20, `content len: ${contentLen}`);
  }

  // ─── 4. search_text ────────────────────────────
  console.log('\n━━━ 4. search_text ━━━');
  {
    const text = getText(
      await callTool('search_text', {
        file_path: SIMPLE_PDF,
        query: 'digital signatures',
        response_format: 'json',
      }),
    );
    const r = JSON.parse(text);
    record(
      'search_text',
      'hit: "digital signatures"',
      r.totalMatches > 0,
      `${r.totalMatches} match(es)`,
    );
    record(
      'search_text',
      'found on page 1',
      r.matches[0]?.page === 1,
      `page ${r.matches[0]?.page}`,
    );
  }
  {
    const text = getText(
      await callTool('search_text', {
        file_path: SIMPLE_PDF,
        query: 'PDF',
        response_format: 'json',
      }),
    );
    const r = JSON.parse(text);
    record(
      'search_text',
      'case-insensitive "PDF"',
      r.totalMatches >= 2,
      `${r.totalMatches} matches`,
    );
  }
  {
    const text = getText(
      await callTool('search_text', {
        file_path: SIMPLE_PDF,
        query: 'nonexistent_xyz',
        response_format: 'json',
      }),
    );
    const r = JSON.parse(text);
    record('search_text', 'miss: 0 matches', r.totalMatches === 0, `${r.totalMatches}`);
  }
  {
    const text = getText(
      await callTool('search_text', {
        file_path: SIMPLE_PDF,
        query: 'xref',
        pages: '2',
        response_format: 'json',
      }),
    );
    const r = JSON.parse(text);
    const allPage2 = r.matches.every((m) => m.page === 2);
    record('search_text', 'page filter: only page 2', allPage2, `all on page 2`);
  }
  {
    const text = getText(
      await callTool('search_text', {
        file_path: SIMPLE_PDF,
        query: 'PDF',
        max_results: 1,
        response_format: 'json',
      }),
    );
    const r = JSON.parse(text);
    record(
      'search_text',
      'max_results=1',
      r.matches.length <= 1,
      `got ${r.matches.length} (truncated: ${r.truncated})`,
    );
  }
  {
    const text = getText(
      await callTool('search_text', {
        file_path: SIMPLE_PDF,
        query: 'digital signatures',
        response_format: 'markdown',
      }),
    );
    record('search_text', 'markdown format', text.includes('# Search Results'), 'has header');
  }

  // ─── 5. read_images ────────────────────────────
  console.log('\n━━━ 5. read_images ━━━');
  {
    const text = getText(await callTool('read_images', { file_path: SIMPLE_PDF }));
    record(
      'read_images',
      'text-only PDF: no images',
      text.includes('No images'),
      `"${text.substring(0, 40)}"`,
    );
  }

  // ─── 6. read_url ───────────────────────────────
  console.log('\n━━━ 6. read_url ━━━');
  {
    const text = getText(
      await callTool('read_url', {
        url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        pages: '1',
      }),
    );
    const ok = text.length > 10 && !text.startsWith('Error');
    record('read_url', 'fetch remote PDF', ok, `length: ${text.length}`);
  }
  {
    const text = getText(
      await callTool('read_url', { url: 'https://example.com/nonexistent.pdf' }),
    );
    record('read_url', 'invalid URL → error', text.includes('Error'), 'got error');
  }

  // ─── 7. summarize ──────────────────────────────
  console.log('\n━━━ 7. summarize ━━━');
  {
    const text = getText(
      await callTool('summarize', { file_path: SIMPLE_PDF, response_format: 'markdown' }),
    );
    record('summarize', 'md: header', text.includes('# PDF Summary'), 'OK');
    record('summarize', 'md: pages', text.includes('3'), 'OK');
    record('summarize', 'md: tagged', text.includes('Tagged'), 'OK');
    record('summarize', 'md: preview', text.includes('Hello PDF World'), 'OK');
  }
  {
    const text = getText(
      await callTool('summarize', { file_path: SIMPLE_PDF, response_format: 'json' }),
    );
    const s = JSON.parse(text);
    record('summarize', 'JSON: pageCount', s.metadata.pageCount === 3, `${s.metadata.pageCount}`);
    record('summarize', 'JSON: hasText', s.hasText === true, `${s.hasText}`);
    record('summarize', 'JSON: imageCount', s.imageCount === 0, `${s.imageCount}`);
    record('summarize', 'JSON: textPreview', s.textPreview.includes('Hello PDF World'), 'OK');
  }

  // ─── 8. Error cases ────────────────────────────
  console.log('\n━━━ 8. Error cases ━━━');
  {
    const text = getText(await callTool('get_page_count', { file_path: '/nonexistent/path.pdf' }));
    record(
      'error',
      'file not found',
      text.includes('Error') && text.includes('not found'),
      text.substring(0, 60),
    );
  }
  {
    const text = getText(await callTool('read_text', { file_path: SIMPLE_PDF, pages: '99' }));
    record('error', 'invalid page (99)', text.includes('Error'), text.substring(0, 60));
  }
  {
    const text = getText(await callTool('get_metadata', { file_path: '/tmp/not-a.pdf' }));
    record('error', 'nonexistent metadata', text.includes('Error'), text.substring(0, 60));
  }

  // ─── Summary ───────────────────────────────────
  server.stdin.end();
  server.kill();

  console.log(`\n${'═'.repeat(60)}`);
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`   [${r.tool}] ${r.scenario}: ${r.detail}`);
    }
  } else {
    console.log('\n🎉 All Tier 1 tools verified successfully!');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
