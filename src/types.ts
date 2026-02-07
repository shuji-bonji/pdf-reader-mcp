/**
 * pdf-reader-mcp shared type definitions
 */

// ─── Tier 1 ──────────────────────────────────────────────

/** Metadata extracted from a PDF document */
export interface PdfMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  pageCount: number;
  pdfVersion: string | null;
  isLinearized: boolean;
  isEncrypted: boolean;
  isTagged: boolean;
  hasSignatures: boolean;
  fileSize: number;
}

/** A single page's extracted text */
export interface PageText {
  page: number;
  text: string;
}

/** A search match within a PDF */
export interface SearchMatch {
  page: number;
  lineIndex: number;
  text: string;
  contextBefore: string;
  contextAfter: string;
}

/** Search results response */
export interface SearchResult {
  query: string;
  totalMatches: number;
  matches: SearchMatch[];
  truncated: boolean;
}

/** An extracted image from a PDF page */
export interface ExtractedImage {
  page: number;
  index: number;
  width: number;
  height: number;
  colorSpace: string;
  bitsPerComponent: number;
  dataBase64: string;
}

/** Result of image extraction including detected vs extracted counts */
export interface ImageExtractionResult {
  images: ExtractedImage[];
  detectedCount: number;
  extractedCount: number;
  skippedCount: number;
}

/** Summary report of a PDF document */
export interface PdfSummary {
  filePath: string;
  metadata: PdfMetadata;
  textPreview: string;
  imageCount: number;
  hasText: boolean;
}

// ─── Tier 2: Structure Analysis ──────────────────────────

/** Catalog entry info */
export interface CatalogEntry {
  key: string;
  type: string;
  value: string;
}

/** Page tree statistics */
export interface PageTreeInfo {
  totalPages: number;
  mediaBoxSamples: Array<{ page: number; width: number; height: number }>;
}

/** Object statistics */
export interface ObjectStats {
  totalObjects: number;
  streamCount: number;
  byType: Record<string, number>;
}

/** inspect_structure output */
export interface StructureAnalysis {
  catalog: CatalogEntry[];
  pageTree: PageTreeInfo;
  objectStats: ObjectStats;
  isEncrypted: boolean;
  pdfVersion: string | null;
}

/** Tag tree node */
export interface TagNode {
  role: string;
  children: TagNode[];
  contentCount: number;
}

/** inspect_tags output */
export interface TagsAnalysis {
  isTagged: boolean;
  rootTag: TagNode | null;
  maxDepth: number;
  totalElements: number;
  roleCounts: Record<string, number>;
}

/** Font information */
export interface FontInfo {
  name: string;
  type: string;
  encoding: string | null;
  isEmbedded: boolean;
  isSubset: boolean;
  pagesUsed: number[];
}

/** inspect_fonts output */
export interface FontsAnalysis {
  fonts: FontInfo[];
  totalFontCount: number;
  embeddedCount: number;
  subsetCount: number;
  pagesScanned: number;
}

/** Annotation information */
export interface AnnotationInfo {
  subtype: string;
  page: number;
  rect: number[] | null;
  contents: string | null;
  author: string | null;
  modificationDate: string | null;
  hasAppearance: boolean;
}

/** inspect_annotations output */
export interface AnnotationsAnalysis {
  totalAnnotations: number;
  bySubtype: Record<string, number>;
  byPage: Record<number, number>;
  annotations: AnnotationInfo[];
  hasLinks: boolean;
  hasForms: boolean;
  hasMarkup: boolean;
}

/** Signature field information */
export interface SignatureFieldInfo {
  fieldName: string;
  isSigned: boolean;
  signerName: string | null;
  reason: string | null;
  location: string | null;
  contactInfo: string | null;
  signingTime: string | null;
  filter: string | null;
  subFilter: string | null;
}

/** inspect_signatures output */
export interface SignaturesAnalysis {
  totalFields: number;
  signedCount: number;
  unsignedCount: number;
  fields: SignatureFieldInfo[];
  note: string;
}

// ─── Tier 3: Validation & Analysis ──────────────────────

/** Severity level for validation issues */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/** A single validation issue */
export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  details?: string;
}

/** validate_tagged output */
export interface TaggedValidation {
  isTagged: boolean;
  totalChecks: number;
  passed: number;
  failed: number;
  warnings: number;
  issues: ValidationIssue[];
  summary: string;
}

/** validate_metadata output */
export interface MetadataValidation {
  totalChecks: number;
  passed: number;
  failed: number;
  warnings: number;
  issues: ValidationIssue[];
  metadata: {
    hasTitle: boolean;
    hasAuthor: boolean;
    hasSubject: boolean;
    hasKeywords: boolean;
    hasCreator: boolean;
    hasProducer: boolean;
    hasCreationDate: boolean;
    hasModificationDate: boolean;
    pdfVersion: string | null;
    isTagged: boolean;
  };
  summary: string;
}

/** Diff entry for structure comparison */
export interface StructureDiffEntry {
  property: string;
  file1Value: string;
  file2Value: string;
  status: 'match' | 'differ';
}

/** compare_structure output */
export interface StructureComparison {
  file1: string;
  file2: string;
  diffs: StructureDiffEntry[];
  fontComparison: {
    onlyInFile1: string[];
    onlyInFile2: string[];
    inBoth: string[];
  };
  summary: string;
}
