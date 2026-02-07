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

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

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
