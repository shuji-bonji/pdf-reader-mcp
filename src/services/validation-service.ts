/**
 * Validation & comparison service for Tier 3 tools.
 *
 * Provides structural comparison between two PDFs (`compare_structure`).
 * The PDF/UA tag and metadata checks (`validate_tagged` / `validate_metadata`)
 * were removed — pass/fail against a standard belongs to pdf-verify-mcp.
 */

import { basename } from 'node:path';
import type { StructureComparison, StructureDiffEntry } from '../types.js';
import { PdfReaderError } from '../utils/error-handler.js';
import { formatFileSize } from '../utils/formatter.js';
import { analyzeFonts } from './font-service.js';
import { getMetadata } from './pdfjs-service.js';
import { half } from './reading-scope.js';
import { analyzeStructure } from './structure-service.js';

// ─── compare_structure ───────────────────────────────────

/**
 * Compare the structure of two PDF documents.
 *
 * Compares:
 * - Page count
 * - PDF version
 * - Encryption status
 * - Tagged status
 * - Total objects
 * - Stream count
 * - Page dimensions (first page)
 * - Fonts used (set difference)
 */
export async function compareStructure(
  filePath1: string,
  filePath2: string,
): Promise<StructureComparison> {
  // 2 つのファイルを並行に読む。
  // 🔴 6 本を 1 つの Promise.all に入れると、どちらのファイルが読めなかったのかが
  // 出力に残らない。ファイル単位でまとめ、失敗したときに名指しできるようにする。
  const [a, b] = await Promise.all([
    half(async () => {
      const [structure, fonts, metadata] = await Promise.all([
        analyzeStructure(filePath1),
        analyzeFonts(filePath1),
        getMetadata(filePath1),
      ]);
      return { structure, fonts, metadata };
    }),
    half(async () => {
      const [structure, fonts, metadata] = await Promise.all([
        analyzeStructure(filePath2),
        analyzeFonts(filePath2),
        getMetadata(filePath2),
      ]);
      return { structure, fonts, metadata };
    }),
  ]);

  // 比べるには 2 つとも要る。片方でも読めなければ答えは出せないが、
  // **どちらが読めなかったか**は言える。0.13.0 まではそれが出力に残らなかった。
  if (!a.ok || !b.ok) {
    const parts: string[] = [];
    if (!a.ok) parts.push(`file_path_1 (${filePath1}): ${a.outcome.code}: ${a.outcome.reason}`);
    if (!b.ok) parts.push(`file_path_2 (${filePath2}): ${b.outcome.code}: ${b.outcome.reason}`);
    throw new PdfReaderError(
      `The comparison needs both files. ${parts.join(' / ')}`,
      'INVALID_PDF',
      !a.ok && !b.ok
        ? 'どちらのファイルも読めませんでした。'
        : `読めなかったのは ${!a.ok ? 'file_path_1' : 'file_path_2'} のほうです。もう一方は読めています。`,
      !a.ok ? a.outcome.code : !b.ok ? b.outcome.code : 'INVALID_PDF',
    );
  }

  const struct1 = a.value.structure;
  const struct2 = b.value.structure;
  const fonts1 = a.value.fonts;
  const fonts2 = b.value.fonts;
  const meta1 = a.value.metadata;
  const meta2 = b.value.metadata;

  const diffs: StructureDiffEntry[] = [];

  // Page count
  addDiff(
    diffs,
    'Page Count',
    String(struct1.pageTree.totalPages),
    String(struct2.pageTree.totalPages),
  );

  // PDF version
  addDiff(diffs, 'PDF Version', struct1.pdfVersion ?? 'Unknown', struct2.pdfVersion ?? 'Unknown');

  // Encrypted
  addDiff(diffs, 'Encrypted', String(struct1.isEncrypted), String(struct2.isEncrypted));

  // Tagged
  addDiff(diffs, 'Tagged', String(meta1.isTagged), String(meta2.isTagged));

  // Total objects
  addDiff(
    diffs,
    'Total Objects',
    String(struct1.objectStats.totalObjects),
    String(struct2.objectStats.totalObjects),
  );

  // Stream count
  addDiff(
    diffs,
    'Stream Count',
    String(struct1.objectStats.streamCount),
    String(struct2.objectStats.streamCount),
  );

  // First page dimensions
  const dim1 = struct1.pageTree.mediaBoxSamples[0];
  const dim2 = struct2.pageTree.mediaBoxSamples[0];
  addDiff(
    diffs,
    'Page 1 Dimensions (pt)',
    dim1 ? `${dim1.width} x ${dim1.height}` : 'N/A',
    dim2 ? `${dim2.width} x ${dim2.height}` : 'N/A',
  );

  // File size
  addDiff(diffs, 'File Size', formatFileSize(meta1.fileSize), formatFileSize(meta2.fileSize));

  // Catalog entry count
  addDiff(diffs, 'Catalog Entries', String(struct1.catalog.length), String(struct2.catalog.length));

  // Signatures
  addDiff(diffs, 'Has Signatures', String(meta1.hasSignatures), String(meta2.hasSignatures));

  // Font comparison
  const fontNames1 = new Set(fonts1.fontMap.keys());
  const fontNames2 = new Set(fonts2.fontMap.keys());
  const onlyInFile1 = [...fontNames1].filter((f) => !fontNames2.has(f));
  const onlyInFile2 = [...fontNames2].filter((f) => !fontNames1.has(f));
  const inBoth = [...fontNames1].filter((f) => fontNames2.has(f));

  addDiff(diffs, 'Total Fonts', String(fontNames1.size), String(fontNames2.size));

  // Summary
  const matchCount = diffs.filter((d) => d.status === 'match').length;
  const diffCount = diffs.filter((d) => d.status === 'differ').length;
  const summary =
    diffCount === 0
      ? `All ${matchCount} properties match between the two PDFs.`
      : `${diffCount} difference(s) found out of ${diffs.length} properties compared.`;

  return {
    file1: basename(filePath1),
    file2: basename(filePath2),
    diffs,
    fontComparison: { onlyInFile1, onlyInFile2, inBoth },
    summary,
  };
}

// ─── Internal helpers ────────────────────────────────────

function addDiff(diffs: StructureDiffEntry[], property: string, val1: string, val2: string): void {
  diffs.push({
    property,
    file1Value: val1,
    file2Value: val2,
    status: val1 === val2 ? 'match' : 'differ',
  });
}
