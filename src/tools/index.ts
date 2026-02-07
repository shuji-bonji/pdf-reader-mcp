/**
 * Tool registration entry point.
 * Registers all available tools with the MCP server.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetMetadata } from './tier1/get-metadata.js';
// Tier 1: Basic tools
import { registerGetPageCount } from './tier1/get-page-count.js';
import { registerReadImages } from './tier1/read-images.js';
import { registerReadText } from './tier1/read-text.js';
import { registerReadUrl } from './tier1/read-url.js';
import { registerSearchText } from './tier1/search-text.js';
import { registerSummarize } from './tier1/summarize.js';

/**
 * Register all tools with the MCP server.
 */
export function registerAllTools(server: McpServer): void {
  // Tier 1: Basic PDF operations
  registerGetPageCount(server);
  registerGetMetadata(server);
  registerReadText(server);
  registerSearchText(server);
  registerReadImages(server);
  registerReadUrl(server);
  registerSummarize(server);

  // Tier 2: Structure analysis (future)
  // registerInspectStructure(server);
  // registerInspectTags(server);
  // registerInspectFonts(server);
  // registerInspectAnnotations(server);
  // registerInspectSignatures(server);

  // Tier 3: Validation & analysis (future)
  // registerValidateTagged(server);
  // registerValidateMetadata(server);
  // registerCompareStructure(server);
}
