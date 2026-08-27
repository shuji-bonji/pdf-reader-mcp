#!/usr/bin/env npx tsx

/**
 * Comprehensive Tier 1 verification script.
 * Tests all 7 tools via the MCP stdio protocol.
 *
 * Usage: npx tsx tests/verify-all-tools.ts
 */

import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const SIMPLE_PDF = resolve(import.meta.dirname, 'fixtures/simple.pdf');
const EMPTY_PDF = resolve(import.meta.dirname, 'fixtures/empty.pdf');

interface TestResult {
  tool: string;
  scenario: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

function record(tool: string, scenario: string, passed: boolean, detail: string) {
  results.push({ tool, scenario, passed, detail });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [${tool}] ${scenario}: ${detail}`);
}

async function main() {
  // Start MCP server as a child process
  const transport = new StdioClientTransport({
    command: 'node',
    args: [resolve(import.meta.dirname, '../dist/index.js')],
  });

  const client = new Client({ name: 'test-client', version: '0.1.0' });
  await client.connect(transport);

  console.log('🔌 Connected to pdf-reader-mcp\n');

  // ─── 1. get_page_count ─────────────────────────────────
  console.log('━━━ 1. get_page_count ━━━');
  {
    const res = await client.callTool({
      name: 'get_page_count',
      arguments: { file_path: SIMPLE_PDF },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    record('get_page_count', 'simple.pdf → 3 pages', text === '3', `got: ${text}`);
  }
  {
    const res = await client.callTool({
      name: 'get_page_count',
      arguments: { file_path: EMPTY_PDF },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    record('get_page_count', 'empty.pdf → 1 page', text === '1', `got: ${text}`);
  }

  // ─── 2. get_metadata ───────────────────────────────────
  console.log('\n━━━ 2. get_metadata ━━━');
  {
    const res = await client.callTool({
      name: 'get_metadata',
      arguments: { file_path: SIMPLE_PDF, response_format: 'json' },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    const meta = JSON.parse(text);
    record(
      'get_metadata',
      'JSON: title',
      meta.title === 'Test PDF Document',
      `got: "${meta.title}"`,
    );
    record(
      'get_metadata',
      'JSON: author',
      meta.author === 'pdf-reader-mcp',
      `got: "${meta.author}"`,
    );
    record('get_metadata', 'JSON: pageCount', meta.pageCount === 3, `got: ${meta.pageCount}`);
    record('get_metadata', 'JSON: isTagged', meta.isTagged === false, `got: ${meta.isTagged}`);
    record('get_metadata', 'JSON: fileSize > 0', meta.fileSize > 0, `got: ${meta.fileSize}`);
  }
  {
    const res = await client.callTool({
      name: 'get_metadata',
      arguments: { file_path: SIMPLE_PDF, response_format: 'markdown' },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    record(
      'get_metadata',
      'Markdown: has header',
      text.includes('# PDF Metadata'),
      `starts with header`,
    );
    record(
      'get_metadata',
      'Markdown: has title',
      text.includes('**Title**: Test PDF Document'),
      `contains title`,
    );
  }

  // ─── 3. read_text ──────────────────────────────────────
  console.log('\n━━━ 3. read_text ━━━');
  {
    const res = await client.callTool({
      name: 'read_text',
      arguments: { file_path: SIMPLE_PDF, pages: '1' },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    record('read_text', 'page 1: has title', text.includes('Hello PDF World'), `found title text`);
    record('read_text', 'page 1: has body', text.includes('test PDF document'), `found body text`);
  }
  {
    const res = await client.callTool({
      name: 'read_text',
      arguments: { file_path: SIMPLE_PDF, pages: '2-3', response_format: 'json' },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    const pages = JSON.parse(text);
    record('read_text', 'pages 2-3: count', pages.length === 2, `got ${pages.length} pages`);
    record(
      'read_text',
      'page 2: content',
      pages[0].text.includes('Page Two'),
      `page 2 has "Page Two"`,
    );
    record(
      'read_text',
      'page 3: content',
      pages[1].text.includes('Page Three'),
      `page 3 has "Page Three"`,
    );
  }
  {
    const res = await client.callTool({
      name: 'read_text',
      arguments: { file_path: EMPTY_PDF },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    record(
      'read_text',
      'empty.pdf: minimal text',
      text.trim().length < 50,
      `length: ${text.trim().length}`,
    );
  }

  // ─── 4. search_text ────────────────────────────────────
  console.log('\n━━━ 4. search_text ━━━');
  {
    const res = await client.callTool({
      name: 'search_text',
      arguments: { file_path: SIMPLE_PDF, query: 'digital signatures', response_format: 'json' },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    const result = JSON.parse(text);
    record(
      'search_text',
      'hit: "digital signatures"',
      result.totalMatches > 0,
      `${result.totalMatches} match(es)`,
    );
    record(
      'search_text',
      'hit: page 1',
      result.matches[0]?.page === 1,
      `found on page ${result.matches[0]?.page}`,
    );
  }
  {
    const res = await client.callTool({
      name: 'search_text',
      arguments: { file_path: SIMPLE_PDF, query: 'PDF', response_format: 'json' },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    const result = JSON.parse(text);
    record(
      'search_text',
      'case-insensitive: "PDF"',
      result.totalMatches >= 2,
      `${result.totalMatches} match(es)`,
    );
  }
  {
    const res = await client.callTool({
      name: 'search_text',
      arguments: { file_path: SIMPLE_PDF, query: 'xyznonexistent', response_format: 'json' },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    const result = JSON.parse(text);
    record(
      'search_text',
      'miss: no matches',
      result.totalMatches === 0,
      `${result.totalMatches} match(es)`,
    );
  }
  {
    const res = await client.callTool({
      name: 'search_text',
      arguments: {
        file_path: SIMPLE_PDF,
        query: 'Page Two',
        pages: '2',
        response_format: 'json',
      },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    const result = JSON.parse(text);
    record(
      'search_text',
      'page filter: page 2 only',
      result.matches.every((m: { page: number }) => m.page === 2),
      `all on page 2`,
    );
  }
  {
    const res = await client.callTool({
      name: 'search_text',
      arguments: {
        file_path: SIMPLE_PDF,
        query: 'digital signatures',
        response_format: 'markdown',
      },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    record(
      'search_text',
      'markdown format',
      text.includes('# Search Results'),
      `has markdown header`,
    );
  }

  // ─── 5. read_images ────────────────────────────────────
  console.log('\n━━━ 5. read_images ━━━');
  {
    const res = await client.callTool({
      name: 'read_images',
      arguments: { file_path: SIMPLE_PDF },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    record(
      'read_images',
      'text-only PDF: no images',
      text.includes('No images found'),
      `got: "${text.substring(0, 40)}"`,
    );
  }

  // ─── 6. read_url ───────────────────────────────────────
  console.log('\n━━━ 6. read_url ━━━');
  {
    // Use a known small public PDF
    const res = await client.callTool({
      name: 'read_url',
      arguments: {
        url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        pages: '1',
      },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    const hasContent = text.length > 10 && !text.startsWith('Error');
    record(
      'read_url',
      'remote PDF fetch',
      hasContent,
      `length: ${text.length}, starts: "${text.substring(0, 50)}..."`,
    );
  }
  {
    const res = await client.callTool({
      name: 'read_url',
      arguments: { url: 'https://example.com/nonexistent.pdf' },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    record('read_url', 'invalid URL: error', text.includes('Error'), `got error response`);
  }

  // ─── 7. summarize ──────────────────────────────────────
  console.log('\n━━━ 7. summarize ━━━');
  {
    const res = await client.callTool({
      name: 'summarize',
      arguments: { file_path: SIMPLE_PDF, response_format: 'markdown' },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    record('summarize', 'markdown: has header', text.includes('# PDF Summary'), `has header`);
    record('summarize', 'markdown: has pages', text.includes('3'), `shows page count`);
    record('summarize', 'markdown: has tagged', text.includes('Tagged'), `shows tagged status`);
    record(
      'summarize',
      'markdown: text preview',
      text.includes('Hello PDF World'),
      `shows text preview`,
    );
  }
  {
    const res = await client.callTool({
      name: 'summarize',
      arguments: { file_path: SIMPLE_PDF, response_format: 'json' },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    const summary = JSON.parse(text);
    record(
      'summarize',
      'JSON: metadata.pageCount',
      summary.metadata.pageCount === 3,
      `got: ${summary.metadata.pageCount}`,
    );
    record('summarize', 'JSON: hasText', summary.hasText === true, `got: ${summary.hasText}`);
    record('summarize', 'JSON: imageCount', summary.imageCount === 0, `got: ${summary.imageCount}`);
  }

  // ─── 8. Error cases ────────────────────────────────────
  console.log('\n━━━ 8. Error cases ━━━');
  {
    const res = await client.callTool({
      name: 'get_page_count',
      arguments: { file_path: '/nonexistent/path.pdf' },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    record(
      'error',
      'nonexistent file',
      text.includes('Error') && text.includes('not found'),
      `got: "${text.substring(0, 60)}"`,
    );
  }
  {
    const res = await client.callTool({
      name: 'read_text',
      arguments: { file_path: SIMPLE_PDF, pages: '99' },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    record(
      'error',
      'invalid page number',
      text.includes('Error'),
      `got: "${text.substring(0, 60)}"`,
    );
  }

  // ─── Summary ───────────────────────────────────────────
  await client.close();

  console.log(`\n${'═'.repeat(60)}`);
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`   [${r.tool}] ${r.scenario}: ${r.detail}`);
    }
    process.exit(1);
  } else {
    console.log('\n🎉 All Tier 1 tools verified successfully!');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
