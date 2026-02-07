/**
 * E2E Test Constants
 *
 * 全テストで共有する定数・期待値・閾値を一元管理する
 */

// ========================================
// Performance thresholds (ms)
// ========================================

export const PERF_THRESHOLDS = {
  getMetadata: 2_000,
  extractText3Pages: 3_000,
  searchText: 2_000,
  analyzeStructure: 2_000,
  analyzeFonts: 3_000,
  validateTagged: 5_000,
  validateMetadata: 3_000,
  compareStructure: 5_000,
  allFixturesMetadata: 15_000,
  countImages: 2_000,
  analyzeSignatures: 2_000,
} as const;

/** Regression detection threshold (±20%) */
export const REGRESSION_THRESHOLD = 0.2;

// ========================================
// PDF page dimensions (pt)
// ========================================

export const A4_SIZE = {
  width: 595,
  height: 842,
} as const;

// ========================================
// Expected metadata per fixture
// ========================================

export const EXPECTED_METADATA = {
  simple: {
    title: 'Test PDF Document',
    author: 'pdf-reader-mcp',
    subject: 'Test fixture',
    creator: 'pdf-lib',
    producer: 'pdf-reader-mcp test suite',
    pageCount: 3,
    isEncrypted: false,
    isLinearized: false,
    isTagged: false,
  },
  empty: {
    title: null,
    author: null,
    pageCount: 1,
  },
  annotated: {
    title: 'Annotated Test PDF',
    author: 'pdf-reader-mcp',
    hasSignatures: true,
    pageCount: 2,
  },
  tagged: {
    title: 'Tagged PDF Document',
    isTagged: true,
    pageCount: 2,
  },
  noMetadata: {
    title: null,
    author: null,
    subject: null,
    keywords: null,
    pageCount: 1,
  },
  multiFont: {
    pageCount: 2,
  },
} as const;

// ========================================
// Text extraction expectations
// ========================================

export const EXPECTED_TEXT = {
  simplePage1Start: 'Hello PDF World',
  simplePage2Keywords: ['Page Two', 'PDF internal structure'] as readonly string[],
  multiFontPage1Keywords: ['Helvetica Regular'] as readonly string[],
  multiFontPage2Keywords: ['Times Roman', 'Courier'] as readonly string[],
  taggedPage1Keywords: ['Tagged PDF Document', 'Accessibility'] as readonly string[],
  taggedPage2Keywords: ['Section Two'] as readonly string[],
} as const;

// ========================================
// Search test data
// ========================================

export const SEARCH_QUERIES = {
  hello: 'Hello',
  pdf: 'PDF',
  helloLower: 'hello',
  nonExistent: 'xyznonexistent',
  test: 'test',
} as const;

// ========================================
// Font family identifiers
// ========================================

export const FONT_FAMILIES = {
  helvetica: 'Helvetica',
  times: 'Times',
  courier: 'Courier',
} as const;

// ========================================
// Image color spaces
// ========================================

export const VALID_COLOR_SPACES = ['RGB', 'RGBA', 'Grayscale'] as const;

export const IMAGE_BITS_PER_COMPONENT = 8;

// ========================================
// Validation constants
// ========================================

export const VALIDATION = {
  taggedTotalChecks: 8,
  metadataTotalChecks: 10,
  /** META-001 through META-010 */
  metadataCheckCodes: Array.from(
    { length: 10 },
    (_, i) => `META-${String(i + 1).padStart(3, '0')}`,
  ),
  tagCheckPattern: /^TAG-\d{3}$/,
  validSeverities: ['error', 'warning', 'info'] as readonly string[],
} as const;

// ========================================
// Structure comparison
// ========================================

export const COMPARISON_PROPERTIES = {
  required: [
    'Page Count',
    'PDF Version',
    'Encrypted',
    'Tagged',
    'Total Objects',
    'File Size',
  ] as readonly string[],
  minPropertyCount: 10,
  validStatuses: ['match', 'differ'] as readonly string[],
} as const;

// ========================================
// Page range test cases
// ========================================

export const PAGE_RANGE_CASES = [
  { input: '2', totalPages: 5, expected: [2], label: 'single page "2" → [2]' },
  { input: '1-3', totalPages: 5, expected: [1, 2, 3], label: 'range "1-3" → [1, 2, 3]' },
  { input: '1,3,5', totalPages: 5, expected: [1, 3, 5], label: 'comma "1,3,5" → [1, 3, 5]' },
  { input: '1,3-5', totalPages: 5, expected: [1, 3, 4, 5], label: 'mixed "1,3-5" → [1, 3, 4, 5]' },
  {
    input: '3,1,2,1',
    totalPages: 5,
    expected: [1, 2, 3],
    label: 'dedup & sort "3,1,2,1" → [1, 2, 3]',
  },
] as const;

// ========================================
// Annotation expectations for annotated.pdf
// ========================================

export const ANNOTATION_EXPECTATIONS = {
  minTotalAnnotations: 4,
  page1MinAnnotations: 2,
  page2MinAnnotations: 2,
  signatureFieldName: 'SignatureField1',
  signatureFieldCount: 1,
} as const;
