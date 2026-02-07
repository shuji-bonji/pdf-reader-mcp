/**
 * Validation & comparison service for Tier 3 tools.
 *
 * Provides PDF/UA tag validation, metadata conformance checks,
 * and structural comparison between two PDFs.
 */

import { basename } from 'node:path';
import type {
  MetadataValidation,
  StructureComparison,
  StructureDiffEntry,
  TaggedValidation,
  ValidationIssue,
} from '../types.js';
import { formatFileSize } from '../utils/formatter.js';
import {
  getMetadata,
  loadDocument,
  analyzeTagsFromDoc,
  countImagesFromDoc,
} from './pdfjs-service.js';
import { analyzeStructure, analyzeFontsWithPdfLib } from './pdflib-service.js';

// ─── validate_tagged ─────────────────────────────────────

/**
 * Validate PDF/UA tagged structure requirements.
 *
 * Checks performed:
 * - Document is marked as tagged
 * - Structure tree root exists
 * - Document-level root tag present
 * - Heading hierarchy (H1-H6) is sequential
 * - Figure tags have content (potential alt text)
 * - Table tags are present when expected
 * - Minimum structure depth
 */
export async function validateTagged(filePath: string): Promise<TaggedValidation> {
  const issues: ValidationIssue[] = [];
  let totalChecks = 0;
  let passed = 0;
  let failed = 0;
  let warnings = 0;

  // ドキュメントを1回だけロードし、タグ解析と画像カウントで共有
  const doc = await loadDocument(filePath);
  let tagsAnalysis: Awaited<ReturnType<typeof analyzeTagsFromDoc>>;
  let imageCount: number;

  try {
    // タグ解析と画像カウントを並列実行
    [tagsAnalysis, imageCount] = await Promise.all([
      analyzeTagsFromDoc(doc),
      countImagesFromDoc(doc),
    ]);
  } finally {
    await doc.destroy();
  }

  // Check 1: Is the document tagged?
  totalChecks++;
  if (!tagsAnalysis.isTagged) {
    failed++;
    issues.push({
      severity: 'error',
      code: 'TAG-001',
      message: 'Document is not tagged',
      details:
        'The PDF does not have the Marked flag set in the MarkInfo dictionary. Tagged PDF is required for PDF/UA compliance.',
    });

    return {
      isTagged: false,
      totalChecks,
      passed,
      failed,
      warnings,
      issues,
      summary: 'Document is not tagged. PDF/UA validation cannot proceed.',
    };
  }
  passed++;
  issues.push({
    severity: 'info',
    code: 'TAG-001',
    message: 'Document is marked as tagged',
  });

  // Check 2: Structure tree root exists
  totalChecks++;
  if (!tagsAnalysis.rootTag) {
    failed++;
    issues.push({
      severity: 'error',
      code: 'TAG-002',
      message: 'No structure tree root found',
      details: 'The document is marked as tagged but has no StructTreeRoot.',
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'TAG-002',
      message: 'Structure tree root exists',
    });
  }

  // Check 3: Document-level root tag
  totalChecks++;
  const hasDocumentTag = tagsAnalysis.roleCounts.Document !== undefined;
  if (!hasDocumentTag) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'TAG-003',
      message: 'No Document root tag found',
      details: 'PDF/UA recommends a single Document tag as the root of the structure tree.',
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'TAG-003',
      message: 'Document root tag present',
    });
  }

  // Check 4: Heading hierarchy
  totalChecks++;
  const headingLevels: number[] = [];
  for (let i = 1; i <= 6; i++) {
    if (tagsAnalysis.roleCounts[`H${i}`]) {
      headingLevels.push(i);
    }
  }
  // Also check generic H tag
  const hasGenericH = tagsAnalysis.roleCounts.H !== undefined;

  if (headingLevels.length === 0 && !hasGenericH) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'TAG-004',
      message: 'No heading tags found',
      details:
        'Document has no heading tags (H1-H6 or H). Headings are recommended for document navigation.',
    });
  } else if (headingLevels.length > 0) {
    // Check for skipped levels
    let isSequential = true;
    if (headingLevels[0] !== 1) {
      isSequential = false;
    }
    for (let i = 1; i < headingLevels.length; i++) {
      if (headingLevels[i] - headingLevels[i - 1] > 1) {
        isSequential = false;
        break;
      }
    }

    if (!isSequential) {
      warnings++;
      issues.push({
        severity: 'warning',
        code: 'TAG-004',
        message: `Heading hierarchy has gaps: ${headingLevels.map((l) => `H${l}`).join(', ')}`,
        details:
          'Heading levels should be sequential without skipping levels (e.g., H1 → H2 → H3).',
      });
    } else {
      passed++;
      issues.push({
        severity: 'info',
        code: 'TAG-004',
        message: `Heading hierarchy is sequential: ${headingLevels.map((l) => `H${l}`).join(', ')}`,
      });
    }
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'TAG-004',
      message: 'Generic H tags used for headings',
    });
  }

  // Check 5: Figure tags for images
  totalChecks++;
  const figureCount = tagsAnalysis.roleCounts.Figure ?? 0;

  if (imageCount > 0 && figureCount === 0) {
    failed++;
    issues.push({
      severity: 'error',
      code: 'TAG-005',
      message: `Document has ${imageCount} image(s) but no Figure tags`,
      details: 'Images must be tagged as Figure with appropriate alt text for PDF/UA compliance.',
    });
  } else if (imageCount > 0 && figureCount < imageCount) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'TAG-005',
      message: `${imageCount} image(s) found but only ${figureCount} Figure tag(s)`,
      details:
        'Some images may not be properly tagged. Decorative images should be marked as artifacts.',
    });
  } else if (imageCount > 0) {
    passed++;
    issues.push({
      severity: 'info',
      code: 'TAG-005',
      message: `${figureCount} Figure tag(s) for ${imageCount} image(s)`,
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'TAG-005',
      message: 'No images detected; Figure tag check not applicable',
    });
  }

  // Check 6: Paragraph tags
  totalChecks++;
  const hasParagraphs = tagsAnalysis.roleCounts.P !== undefined;
  if (!hasParagraphs) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'TAG-006',
      message: 'No P (Paragraph) tags found',
      details: 'Text content should be wrapped in P tags for proper reading order.',
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'TAG-006',
      message: `${tagsAnalysis.roleCounts.P} Paragraph tag(s) found`,
    });
  }

  // Check 7: Minimum element count
  totalChecks++;
  if (tagsAnalysis.totalElements < 2) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'TAG-007',
      message: `Only ${tagsAnalysis.totalElements} structure element(s) found`,
      details:
        'A properly tagged document should have multiple structure elements reflecting its content.',
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'TAG-007',
      message: `${tagsAnalysis.totalElements} structure elements found`,
    });
  }

  // Check 8: Table tags
  totalChecks++;
  const tableCount = tagsAnalysis.roleCounts.Table ?? 0;
  const trCount = tagsAnalysis.roleCounts.TR ?? 0;
  const tdCount = tagsAnalysis.roleCounts.TD ?? 0;
  const thCount = tagsAnalysis.roleCounts.TH ?? 0;

  if (tableCount > 0) {
    if (trCount === 0) {
      warnings++;
      issues.push({
        severity: 'warning',
        code: 'TAG-008',
        message: `${tableCount} Table tag(s) but no TR (Table Row) tags`,
        details: 'Tables should contain TR, TH, and TD tags for proper structure.',
      });
    } else if (thCount === 0) {
      warnings++;
      issues.push({
        severity: 'warning',
        code: 'TAG-008',
        message: `Table has ${trCount} row(s) but no TH (Table Header) tags`,
        details: 'PDF/UA requires tables to have header cells (TH) for accessibility.',
      });
    } else {
      passed++;
      issues.push({
        severity: 'info',
        code: 'TAG-008',
        message: `Table structure: ${tableCount} table(s), ${trCount} row(s), ${thCount} header(s), ${tdCount} cell(s)`,
      });
    }
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'TAG-008',
      message: 'No Table tags found; table check not applicable',
    });
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;

  let summary: string;
  if (errorCount === 0 && warnCount === 0) {
    summary = `All ${totalChecks} checks passed. Document appears well-structured for PDF/UA compliance.`;
  } else if (errorCount === 0) {
    summary = `${passed}/${totalChecks} checks passed with ${warnCount} warning(s). Review warnings for full PDF/UA compliance.`;
  } else {
    summary = `${passed}/${totalChecks} checks passed, ${errorCount} error(s), ${warnCount} warning(s). Critical issues must be resolved for PDF/UA compliance.`;
  }

  return {
    isTagged: true,
    totalChecks,
    passed,
    failed,
    warnings,
    issues,
    summary,
  };
}

// ─── validate_metadata ───────────────────────────────────

/**
 * Validate PDF metadata conformance.
 *
 * Checks performed:
 * - Title is present (required for PDF/UA, PDF/A)
 * - Author is present
 * - CreationDate format
 * - ModificationDate format
 * - Producer is present
 * - PDF version is detected
 * - Document is tagged (metadata flag)
 * - Subject and Keywords (informational)
 */
export async function validateMetadata(filePath: string): Promise<MetadataValidation> {
  const issues: ValidationIssue[] = [];
  let totalChecks = 0;
  let passed = 0;
  let failed = 0;
  let warnings = 0;

  const meta = await getMetadata(filePath);

  // Check 1: Title
  totalChecks++;
  if (!meta.title) {
    failed++;
    issues.push({
      severity: 'error',
      code: 'META-001',
      message: 'Title is missing',
      details:
        'A document title is required for PDF/UA and PDF/A compliance. It is used by assistive technology and search engines.',
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'META-001',
      message: `Title: "${meta.title}"`,
    });
  }

  // Check 2: Author
  totalChecks++;
  if (!meta.author) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'META-002',
      message: 'Author is missing',
      details: 'Author metadata is recommended for document identification.',
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'META-002',
      message: `Author: "${meta.author}"`,
    });
  }

  // Check 3: CreationDate
  totalChecks++;
  if (!meta.creationDate) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'META-003',
      message: 'Creation date is missing',
      details: 'Creation date metadata is recommended.',
    });
  } else {
    const isValidDate = isValidPdfDate(meta.creationDate);
    if (isValidDate) {
      passed++;
      issues.push({
        severity: 'info',
        code: 'META-003',
        message: `Creation date: ${meta.creationDate}`,
      });
    } else {
      warnings++;
      issues.push({
        severity: 'warning',
        code: 'META-003',
        message: `Creation date format may be non-standard: ${meta.creationDate}`,
        details: "PDF date format should follow D:YYYYMMDDHHmmSSOHH'mm'.",
      });
    }
  }

  // Check 4: ModificationDate
  totalChecks++;
  if (!meta.modificationDate) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'META-004',
      message: 'Modification date is missing',
      details: 'Modification date metadata is recommended for document tracking.',
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'META-004',
      message: `Modification date: ${meta.modificationDate}`,
    });
  }

  // Check 5: Producer
  totalChecks++;
  if (!meta.producer) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'META-005',
      message: 'Producer is missing',
      details:
        'Producer identifies the application that created the PDF. Useful for debugging rendering issues.',
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'META-005',
      message: `Producer: "${meta.producer}"`,
    });
  }

  // Check 6: PDF version
  totalChecks++;
  if (!meta.pdfVersion) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'META-006',
      message: 'PDF version not detected',
      details: 'The PDF version could not be determined from the file header.',
    });
  } else {
    passed++;
    const version = Number.parseFloat(meta.pdfVersion);
    if (version < 1.4) {
      issues.push({
        severity: 'info',
        code: 'META-006',
        message: `PDF version: ${meta.pdfVersion} (pre-1.4; limited feature support)`,
      });
    } else {
      issues.push({
        severity: 'info',
        code: 'META-006',
        message: `PDF version: ${meta.pdfVersion}`,
      });
    }
  }

  // Check 7: Tagged flag
  totalChecks++;
  if (!meta.isTagged) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'META-007',
      message: 'Document is not tagged',
      details: 'Tagged PDF is required for PDF/UA compliance and recommended for accessibility.',
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'META-007',
      message: 'Document is tagged',
    });
  }

  // Check 8: Subject
  totalChecks++;
  if (!meta.subject) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'META-008',
      message: 'Subject is missing',
      details: 'Subject metadata helps describe the document purpose.',
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'META-008',
      message: `Subject: "${meta.subject}"`,
    });
  }

  // Check 9: Keywords
  totalChecks++;
  if (!meta.keywords) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'META-009',
      message: 'Keywords are missing',
      details: 'Keywords metadata aids document discoverability.',
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'META-009',
      message: `Keywords: "${meta.keywords}"`,
    });
  }

  // Check 10: Encryption and accessibility
  totalChecks++;
  if (meta.isEncrypted) {
    warnings++;
    issues.push({
      severity: 'warning',
      code: 'META-010',
      message: 'Document is encrypted',
      details:
        'Encryption may restrict assistive technology access. Ensure accessibility permissions are enabled.',
    });
  } else {
    passed++;
    issues.push({
      severity: 'info',
      code: 'META-010',
      message: 'Document is not encrypted',
    });
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;

  let summary: string;
  if (errorCount === 0 && warnCount === 0) {
    summary = `All ${totalChecks} metadata checks passed.`;
  } else if (errorCount === 0) {
    summary = `${passed}/${totalChecks} checks passed with ${warnCount} warning(s).`;
  } else {
    summary = `${passed}/${totalChecks} checks passed, ${errorCount} error(s), ${warnCount} warning(s).`;
  }

  return {
    totalChecks,
    passed,
    failed,
    warnings,
    issues,
    metadata: {
      hasTitle: !!meta.title,
      hasAuthor: !!meta.author,
      hasSubject: !!meta.subject,
      hasKeywords: !!meta.keywords,
      hasCreator: !!meta.creator,
      hasProducer: !!meta.producer,
      hasCreationDate: !!meta.creationDate,
      hasModificationDate: !!meta.modificationDate,
      pdfVersion: meta.pdfVersion,
      isTagged: meta.isTagged,
    },
    summary,
  };
}

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
  // Analyze both files in parallel
  const [struct1, struct2, fonts1, fonts2, meta1, meta2] = await Promise.all([
    analyzeStructure(filePath1),
    analyzeStructure(filePath2),
    analyzeFontsWithPdfLib(filePath1),
    analyzeFontsWithPdfLib(filePath2),
    getMetadata(filePath1),
    getMetadata(filePath2),
  ]);

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

/**
 * Check if a date string looks like a valid PDF date format.
 *
 * Per ISO 32000-1 §7.9.4, PDF date format is:
 *   D:YYYYMMDDHHmmSSOHH'mm'
 * where YYYY is required and other parts are optional.
 * O is the timezone indicator: +, -, or Z.
 *
 * Also accepts ISO 8601 dates (YYYY-MM-DDTHH:mm:ss).
 */
function isValidPdfDate(dateStr: string): boolean {
  // PDF date: D:YYYY with optional MM DD HH mm SS and timezone
  if (/^D:\d{4}(\d{2}(\d{2}(\d{2}(\d{2}(\d{2}([+-Z](\d{2}'\d{2}'?)?)?)?)?)?)?)?$/.test(dateStr)) {
    return true;
  }
  // ISO 8601 dates: YYYY-MM-DD with optional time
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)?)?$/.test(dateStr)) {
    return true;
  }
  return false;
}
