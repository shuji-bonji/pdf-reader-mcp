#!/usr/bin/env node
/**
 * pdf-reader-mcp - MCP server for PDF structure analysis.
 *
 * Provides tools to read, inspect, and validate PDF internals.
 * Designed to work alongside pdf-spec-mcp for specification-aware analysis.
 */

// IMPORTANT: Guard stdout before any imports.
// pdfjs-dist's warn() uses console.log (= stdout), which corrupts the
// stdio JSON-RPC stream. Redirect console.log/console.warn to stderr.
const _originalConsoleLog = console.log;
const _originalConsoleWarn = console.warn;
console.log = (...args: unknown[]) => console.error('[log]', ...args);
console.warn = (...args: unknown[]) => console.error('[warn]', ...args);

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SERVER_NAME, SERVER_VERSION } from './constants.js';
import { registerAllTools } from './tools/index.js';

/**
 * `initialize` の応答としてクライアントへ返す説明（family 規約: PDFfamily specs/06）。
 *
 * **reader の出力は「観測」であって「判定」ではない。** ツール説明にも書いてあるが、
 * `instructions` はクライアントのシステムコンテキストに直接載るため、ツールを 1 つも
 * 呼ばないうちに読まれる — 射程を伝える位置としてはここが最も早い。
 * 先例は pdf-spec-mcp v0.4.5（Issue #13）。
 */
const INSTRUCTIONS = `${SERVER_NAME} v${SERVER_VERSION} — the running build identifies itself here so a stale install is visible without a tool call; compare against \`npm view @shuji-bonji/pdf-reader-mcp version\` when freshness matters.

This server OBSERVES what is inside a PDF. It does not judge whether it is correct.

Everything it returns is an observation: extracted text, tables, the structure tree, fonts,
annotations, images, and the *structure* of signature fields. Treat the output as evidence,
never as a verdict.

What it does NOT do:
  - No cryptographic verification. inspect_signatures reads signature fields structurally and
    says so explicitly; whether a signature is mathematically valid is pdf-verify-mcp's answer
    (verify_signatures / verify_integrity).
  - No conformance judgement. validate_tagged / validate_metadata are deprecated in favour of
    pdf-verify-mcp's validate_conformance, which delegates to veraPDF.
  - No incremental-update history (that is pdf-verify-mcp verify_integrity), and no OCR.

It DOES map content to coordinates: locate_objects turns an object number into a page and a
rectangle, and extract_structured_text with include_bbox does the same for a structure element.
Both answer in the form pdf-writer-mcp add_annotation takes, so "annotate the thing that
changed" needs no coordinate conversion in between. Every rectangle names its basis — a
measurement and a rectangle the file merely declares are not the same claim.

Where an observation here and a verdict from pdf-verify-mcp disagree, the verdict wins —
this server reads the file, the validator applies the rules.

For what the specification *requires*, ask pdf-spec-mcp. This server never quotes ISO clauses.`;

const server = new McpServer(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  { instructions: INSTRUCTIONS },
);

// Register all tools
registerAllTools(server);

// Start the server with stdio transport
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running via stdio`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
