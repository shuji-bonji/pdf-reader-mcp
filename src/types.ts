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
  /**
   * Colour space of the decoded buffer: 'Grayscale' | 'RGB' | 'RGBA'
   * ('Unknown' if pdfjs reports a kind we do not recognise).
   * This describes pdfjs's normalised output, not the raw image XObject's
   * /ColorSpace entry.
   */
  colorSpace: string;
  /** Bits per component of the decoded buffer: 1 for Grayscale, 8 for RGB/RGBA. */
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
  /**
   * Optional human-readable note describing partial / fallback results.
   * Set when the PDF could not be fully analyzed via pdf-lib alone (e.g.
   * Linearized PDFs whose cross-reference cannot be fully resolved) and
   * the page count was obtained via pdfjs-dist instead.
   */
  note?: string;
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
  /**
   * Optional human-readable note describing partial / fallback results.
   * Set when fonts could not be enumerated via pdf-lib (e.g. Linearized PDFs
   * whose page tree cannot be fully resolved).
   */
  note?: string;
}

/** A single cell within an extracted table row. */
export interface TableCell {
  /** Concatenated text content of the cell (whitespace compacted). */
  text: string;
  /** True when the cell came from a `TH` element (header), false for `TD`. */
  isHeader: boolean;
}

/** A table row composed of one or more cells. */
export interface TableRow {
  cells: TableCell[];
}

/** A single table extracted from a Tagged PDF's structure tree. */
export interface ExtractedTable {
  /** 1-based page number where the table appears. */
  page: number;
  /** 1-based index of the table within the page (1 = first table on the page). */
  index: number;
  /** Rows from `<THead>`. Empty if the table has no explicit header section. */
  headerRows: TableRow[];
  /** Rows from `<TBody>` (or directly under `<Table>` when no `<TBody>` exists). */
  bodyRows: TableRow[];
  /** Rows from `<TFoot>`. Rare; usually empty. */
  footerRows: TableRow[];
}

/** Output of `extract_tables`. */
export interface TablesExtractionResult {
  /** Whether the PDF claims to be tagged (`/MarkInfo /Marked true`). */
  isTagged: boolean;
  /** All tables extracted from the requested pages. */
  tables: ExtractedTable[];
  /** Total number of tables across `pagesScanned`. */
  totalTables: number;
  /** Number of pages traversed (subject to the `pages` filter). */
  pagesScanned: number;
  /**
   * Optional human-readable note. Set when no tables could be extracted
   * because the PDF is not tagged (in that case callers should fall back to
   * the planned column-aware extraction).
   */
  note?: string;
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
