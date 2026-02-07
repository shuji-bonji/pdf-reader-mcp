/**
 * Response formatting utilities for Markdown and JSON output.
 */

import { CHARACTER_LIMIT } from '../constants.js';
import type { PageText, PdfMetadata, PdfSummary, SearchResult } from '../types.js';

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

/**
 * Format file size in human-readable form.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
