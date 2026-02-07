/**
 * Response formatting utilities for Markdown and JSON output.
 */

import { CHARACTER_LIMIT } from '../constants.js';
import type {
  AnnotationsAnalysis,
  FontsAnalysis,
  PageText,
  PdfMetadata,
  PdfSummary,
  SearchResult,
  SignaturesAnalysis,
  StructureAnalysis,
  TagNode,
  TagsAnalysis,
} from '../types.js';

/**
 * Truncate text to CHARACTER_LIMIT with a notice.
 */
export function truncateIfNeeded(text: string): { text: string; truncated: boolean } {
  if (text.length <= CHARACTER_LIMIT) {
    return { text, truncated: false };
  }
  const truncated = text.slice(0, CHARACTER_LIMIT);
  return {
    text:
      truncated +
      '\n\n---\n⚠️ Response truncated. Use page range parameters to retrieve specific sections.',
    truncated: true,
  };
}

/**
 * Format metadata as Markdown.
 */
export function formatMetadataMarkdown(meta: PdfMetadata): string {
  const lines: string[] = ['# PDF Metadata', ''];

  const fields: [string, string | number | boolean | null][] = [
    ['Title', meta.title],
    ['Author', meta.author],
    ['Subject', meta.subject],
    ['Keywords', meta.keywords],
    ['Creator', meta.creator],
    ['Producer', meta.producer],
    ['Creation Date', meta.creationDate],
    ['Modification Date', meta.modificationDate],
    ['Page Count', meta.pageCount],
    ['PDF Version', meta.pdfVersion],
    ['Linearized', meta.isLinearized],
    ['Encrypted', meta.isEncrypted],
    ['Tagged', meta.isTagged],
    ['Has Signatures', meta.hasSignatures],
    ['File Size', formatFileSize(meta.fileSize)],
  ];

  for (const [label, value] of fields) {
    if (value !== null && value !== undefined) {
      const displayValue = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
      lines.push(`- **${label}**: ${displayValue}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format page texts as Markdown.
 */
export function formatPageTextsMarkdown(pages: PageText[]): string {
  const lines: string[] = [];

  for (const page of pages) {
    lines.push(`## Page ${page.page}`, '', page.text, '');
  }

  return lines.join('\n');
}

/**
 * Format search results as Markdown.
 */
export function formatSearchResultMarkdown(result: SearchResult): string {
  const lines: string[] = [
    `# Search Results: "${result.query}"`,
    '',
    `Found **${result.totalMatches}** match${result.totalMatches !== 1 ? 'es' : ''}`,
    '',
  ];

  for (const match of result.matches) {
    lines.push(
      `### Page ${match.page}`,
      '',
      `> ...${match.contextBefore}**${match.text}**${match.contextAfter}...`,
      '',
    );
  }

  if (result.truncated) {
    lines.push('---', '⚠️ Results truncated. Use page range parameters to narrow the search.');
  }

  return lines.join('\n');
}

/**
 * Format summary as Markdown.
 */
export function formatSummaryMarkdown(summary: PdfSummary): string {
  const meta = summary.metadata;
  const lines: string[] = [
    `# PDF Summary`,
    '',
    `| Property | Value |`,
    `|---|---|`,
    `| Pages | ${meta.pageCount} |`,
    `| PDF Version | ${meta.pdfVersion ?? 'Unknown'} |`,
    `| File Size | ${formatFileSize(meta.fileSize)} |`,
    `| Tagged | ${meta.isTagged ? 'Yes' : 'No'} |`,
    `| Encrypted | ${meta.isEncrypted ? 'Yes' : 'No'} |`,
    `| Signatures | ${meta.hasSignatures ? 'Yes' : 'No'} |`,
    `| Has Text | ${summary.hasText ? 'Yes' : 'No'} |`,
    `| Images | ${summary.imageCount} |`,
  ];

  if (meta.title) lines.push(`| Title | ${meta.title} |`);
  if (meta.author) lines.push(`| Author | ${meta.author} |`);

  if (summary.textPreview) {
    lines.push('', '## Text Preview (first page)', '', summary.textPreview);
  }

  return lines.join('\n');
}

// ─── Tier 2: Structure analysis formatters ───────────────

/**
 * Format structure analysis as Markdown.
 */
export function formatStructureMarkdown(analysis: StructureAnalysis): string {
  const lines: string[] = ['# PDF Structure Analysis', ''];

  // Catalog
  lines.push('## Catalog Entries', '');
  lines.push('| Key | Type | Value |', '|---|---|---|');
  for (const entry of analysis.catalog) {
    lines.push(`| ${entry.key} | ${entry.type} | ${entry.value} |`);
  }

  // Page tree
  lines.push('', '## Page Tree', '');
  lines.push(`- **Total Pages**: ${analysis.pageTree.totalPages}`);
  if (analysis.pageTree.mediaBoxSamples.length > 0) {
    lines.push('- **MediaBox Samples**:');
    for (const s of analysis.pageTree.mediaBoxSamples) {
      lines.push(`  - Page ${s.page}: ${s.width} × ${s.height} pt`);
    }
  }

  // Object stats
  lines.push('', '## Object Statistics', '');
  lines.push(`- **Total Objects**: ${analysis.objectStats.totalObjects}`);
  lines.push(`- **Streams**: ${analysis.objectStats.streamCount}`);
  lines.push('- **By Type**:');
  for (const [type, count] of Object.entries(analysis.objectStats.byType)) {
    lines.push(`  - ${type}: ${count}`);
  }

  // Flags
  lines.push('', '## Properties', '');
  lines.push(`- **Encrypted**: ${analysis.isEncrypted ? 'Yes' : 'No'}`);
  if (analysis.pdfVersion) {
    lines.push(`- **Catalog Version**: ${analysis.pdfVersion}`);
  }

  return lines.join('\n');
}

/**
 * Format tags analysis as Markdown.
 */
export function formatTagsMarkdown(analysis: TagsAnalysis): string {
  const lines: string[] = ['# Tagged PDF Analysis', ''];

  lines.push(`- **Tagged**: ${analysis.isTagged ? 'Yes' : 'No'}`);

  if (!analysis.isTagged || !analysis.rootTag) {
    lines.push('', 'This PDF is not tagged. No structure tree available.');
    return lines.join('\n');
  }

  lines.push(`- **Total Elements**: ${analysis.totalElements}`);
  lines.push(`- **Max Depth**: ${analysis.maxDepth}`);

  // Role counts
  lines.push('', '## Role Distribution', '');
  lines.push('| Role | Count |', '|---|---|');
  const sortedRoles = Object.entries(analysis.roleCounts).sort(([, a], [, b]) => b - a);
  for (const [role, count] of sortedRoles) {
    lines.push(`| ${role} | ${count} |`);
  }

  // Tag tree (limited depth for readability)
  lines.push('', '## Structure Tree', '');
  renderTagTree(analysis.rootTag, lines, 0, 4);

  return lines.join('\n');
}

/**
 * Format fonts analysis as Markdown.
 */
export function formatFontsMarkdown(analysis: FontsAnalysis): string {
  const lines: string[] = ['# Font Analysis', ''];

  lines.push(`- **Total Fonts**: ${analysis.totalFontCount}`);
  lines.push(`- **Embedded**: ${analysis.embeddedCount}`);
  lines.push(`- **Subset**: ${analysis.subsetCount}`);
  lines.push(`- **Pages Scanned**: ${analysis.pagesScanned}`);

  if (analysis.fonts.length === 0) {
    lines.push('', 'No fonts found in this document.');
    return lines.join('\n');
  }

  lines.push('', '## Font Details', '');
  lines.push('| Name | Type | Encoding | Embedded | Subset | Pages |', '|---|---|---|---|---|---|');
  for (const f of analysis.fonts) {
    const pages =
      f.pagesUsed.length > 5 ? `${f.pagesUsed.slice(0, 5).join(',')}...` : f.pagesUsed.join(',');
    lines.push(
      `| ${f.name} | ${f.type} | ${f.encoding ?? '-'} | ${f.isEmbedded ? 'Yes' : 'No'} | ${f.isSubset ? 'Yes' : 'No'} | ${pages} |`,
    );
  }

  return lines.join('\n');
}

/**
 * Format annotations analysis as Markdown.
 */
export function formatAnnotationsMarkdown(analysis: AnnotationsAnalysis): string {
  const lines: string[] = ['# Annotation Analysis', ''];

  lines.push(`- **Total Annotations**: ${analysis.totalAnnotations}`);
  lines.push(`- **Has Links**: ${analysis.hasLinks ? 'Yes' : 'No'}`);
  lines.push(`- **Has Forms**: ${analysis.hasForms ? 'Yes' : 'No'}`);
  lines.push(`- **Has Markup**: ${analysis.hasMarkup ? 'Yes' : 'No'}`);

  if (analysis.totalAnnotations === 0) {
    lines.push('', 'No annotations found in the specified pages.');
    return lines.join('\n');
  }

  // By subtype
  lines.push('', '## By Type', '');
  lines.push('| Subtype | Count |', '|---|---|');
  const sortedTypes = Object.entries(analysis.bySubtype).sort(([, a], [, b]) => b - a);
  for (const [subtype, count] of sortedTypes) {
    lines.push(`| ${subtype} | ${count} |`);
  }

  // By page
  lines.push('', '## By Page', '');
  lines.push('| Page | Count |', '|---|---|');
  const sortedPages = Object.entries(analysis.byPage)
    .map(([p, c]) => [Number(p), c] as [number, number])
    .sort(([a], [b]) => a - b);
  for (const [page, count] of sortedPages) {
    lines.push(`| ${page} | ${count} |`);
  }

  return lines.join('\n');
}

/**
 * Format signatures analysis as Markdown.
 */
export function formatSignaturesMarkdown(analysis: SignaturesAnalysis): string {
  const lines: string[] = ['# Digital Signature Analysis', ''];

  lines.push(`- **Total Signature Fields**: ${analysis.totalFields}`);
  lines.push(`- **Signed**: ${analysis.signedCount}`);
  lines.push(`- **Unsigned**: ${analysis.unsignedCount}`);

  if (analysis.totalFields === 0) {
    lines.push('', 'No signature fields found in this document.');
    lines.push('', `> ${analysis.note}`);
    return lines.join('\n');
  }

  lines.push('', '## Signature Fields', '');
  for (const field of analysis.fields) {
    lines.push(`### ${field.fieldName}`, '');
    lines.push(`- **Signed**: ${field.isSigned ? 'Yes' : 'No'}`);
    if (field.signerName) lines.push(`- **Signer**: ${field.signerName}`);
    if (field.reason) lines.push(`- **Reason**: ${field.reason}`);
    if (field.location) lines.push(`- **Location**: ${field.location}`);
    if (field.signingTime) lines.push(`- **Signing Time**: ${field.signingTime}`);
    if (field.filter) lines.push(`- **Filter**: ${field.filter}`);
    if (field.subFilter) lines.push(`- **SubFilter**: ${field.subFilter}`);
    lines.push('');
  }

  lines.push(`> ${analysis.note}`);

  return lines.join('\n');
}

// ─── Internal helpers ────────────────────────────────────

/**
 * Format file size in human-readable form.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Render tag tree as indented Markdown list (limited depth).
 */
function renderTagTree(node: TagNode, lines: string[], depth: number, maxDepth: number): void {
  if (depth > maxDepth) {
    lines.push(`${'  '.repeat(depth)}- ... (truncated at depth ${maxDepth})`);
    return;
  }

  const indent = '  '.repeat(depth);
  const contentSuffix = node.contentCount > 0 ? ` (${node.contentCount} content items)` : '';
  lines.push(`${indent}- **${node.role}**${contentSuffix}`);

  for (const child of node.children) {
    renderTagTree(child, lines, depth + 1, maxDepth);
  }
}
