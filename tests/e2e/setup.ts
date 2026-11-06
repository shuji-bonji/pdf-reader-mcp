/**
 * E2E Test Common Setup
 *
 * フィクスチャパス定義・存在チェック・期待値テーブル
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures');

// ========================================
// Fixture paths
// ========================================

export const FIXTURES = {
  simple: resolve(FIXTURES_DIR, 'simple.pdf'),
  empty: resolve(FIXTURES_DIR, 'empty.pdf'),
  annotated: resolve(FIXTURES_DIR, 'annotated.pdf'),
  comprehensive: resolve(FIXTURES_DIR, 'comprehensive_1.pdf'),
  tagged: resolve(FIXTURES_DIR, 'tagged.pdf'),
  multiFont: resolve(FIXTURES_DIR, 'multi-font.pdf'),
  /**
   * Type0 (composite / CID) fonts — embedded, non-embedded, and malformed.
   * High-1 regression: the FontDescriptor of a Type0 font lives on the CIDFont
   * in DescendantFonts, not on the Type0 dictionary itself.
   */
  cidFont: resolve(FIXTURES_DIR, 'cid-font.pdf'),
  /**
   * One image per pdfjs ImageKind (RGB / RGBA / 1bpp grayscale).
   * High-2 regression (kind mapping) and D-9 regression (read_images extracted
   * nothing at all, so the mapping was never reached).
   */
  imageKinds: resolve(FIXTURES_DIR, 'image-kinds.pdf'),
  /**
   * A REAL tagged PDF with page-spanning elements (M-8).
   * `tagged.pdf` has a structure tree but no marked content, so nothing connects;
   * this one does. Its P and L each span pages 1–2.
   */
  structured: resolve(FIXTURES_DIR, 'structured.pdf'),
  /**
   * ONE Table StructElem continuing across a page break (#14).
   * A per-page walk slices it into two fragments; the StructTreeRoot walker
   * must report one table with pages [1, 2].
   */
  spanningTable: resolve(FIXTURES_DIR, 'spanning-table.pdf'),
  /**
   * Structure element → drawing rectangle (#20 stage 2).
   * Declared `/BBox` through `/A` and through `/C` + `/ClassMap`, a declaration
   * that contradicts its own text, text rotated 45°, and a page whose MediaBox
   * origin is not (0,0) and which is `/Rotate 90`.
   */
  elementBbox: resolve(FIXTURES_DIR, 'element-bbox.pdf'),
  /**
   * Image-only pages, no text-showing operator (#21).
   * The `no_text_layer` specimen: `image-kinds.pdf` cannot serve, because it
   * draws body text as well.
   */
  noTextLayer: resolve(FIXTURES_DIR, 'no-text-layer.pdf'),
  /**
   * Identity-H with a correct `/ToUnicode` CMap (#21).
   * The `extracted` control for composite fonts — without it a rule that
   * answered `not_extractable` for every Type0 font would still pass.
   */
  toUnicodeCid: resolve(FIXTURES_DIR, 'tounicode-cid.pdf'),
  /**
   * A page drawn ONLY with an Identity-H font that has no `/ToUnicode` (#21).
   * The total-loss specimen; `cid-font.pdf` is the partial one.
   */
  brokenCidOnly: resolve(FIXTURES_DIR, 'broken-cid-only.pdf'),
  /**
   * `/ActualText` on marked-content sequences, in an UNTAGGED document (#18).
   * Page 1 is the ISO 32000-2 §14.9.4 EXAMPLE ("Druk-"/"ker" → "Drucker");
   * page 2 has two consecutive Spans with ActualText, for R-14.9.4-3.
   */
  actualTextSpan: resolve(FIXTURES_DIR, 'actual-text-span.pdf'),
  /**
   * An RC4-encrypted tagged PDF whose `/ActualText` is ciphertext (#18).
   * pdf-lib does not decrypt, so anything that trusts the string it returns
   * substitutes garbage for the page text.
   */
  encryptedActualText: resolve(FIXTURES_DIR, 'encrypted-actualtext.pdf'),
  /**
   * Document-level components for `inspect_catalog` (#27): outlines, optional
   * content, embedded files, XMP declarations (pdfaid / pdfuaid / TDMRep),
   * /OpenAction with a /Next JavaScript action, /AA.
   */
  catalogFeatures: resolve(FIXTURES_DIR, 'catalog-features.pdf'),
  /**
   * Nested lists in the two places the standard allows (#52): inside the parent
   * item's LBody (ISO 32000-1 Table 336; pdf-writer-mcp 0.25.0), and as a direct
   * child of the parent L (ISO 32000-2 §14.8.4.8.2, example H.8.3).
   */
  nestedLists: resolve(FIXTURES_DIR, 'nested-lists.pdf'),
  noMetadata: resolve(FIXTURES_DIR, 'no-metadata.pdf'),
  corrupted: resolve(FIXTURES_DIR, 'corrupted.pdf'),
  /** Linearized variant of simple.pdf (Issue #1 regression). */
  linearized: resolve(FIXTURES_DIR, 'linearized.pdf'),
  /** Untagged 2-column layout (Issue #3 regression for split_columns). */
  twoColumn: resolve(FIXTURES_DIR, 'two-column.pdf'),
} as const;

// ========================================
// Fixture expectations (parametric test table)
// ========================================

export interface FixtureExpectation {
  path: string;
  name: string;
  pageCount: number;
  hasText: boolean;
  hasTitle: boolean;
  hasAnnotations: boolean;
  hasSignatureFields: boolean;
}

export const ALL_FIXTURES: FixtureExpectation[] = [
  {
    path: FIXTURES.simple,
    name: 'simple.pdf',
    pageCount: 3,
    hasText: true,
    hasTitle: true,
    hasAnnotations: false,
    hasSignatureFields: false,
  },
  {
    path: FIXTURES.empty,
    name: 'empty.pdf',
    pageCount: 1,
    hasText: false,
    hasTitle: false,
    hasAnnotations: false,
    hasSignatureFields: false,
  },
  {
    path: FIXTURES.annotated,
    name: 'annotated.pdf',
    pageCount: 2,
    hasText: true,
    hasTitle: true,
    hasAnnotations: true,
    hasSignatureFields: true,
  },
  {
    path: FIXTURES.comprehensive,
    name: 'comprehensive_1.pdf',
    pageCount: 4,
    hasText: true,
    hasTitle: true,
    hasAnnotations: false,
    hasSignatureFields: false,
  },
  {
    path: FIXTURES.tagged,
    name: 'tagged.pdf',
    pageCount: 2,
    hasText: true,
    hasTitle: true,
    hasAnnotations: false,
    hasSignatureFields: false,
  },
  {
    path: FIXTURES.multiFont,
    name: 'multi-font.pdf',
    pageCount: 2,
    hasText: true,
    hasTitle: true,
    hasAnnotations: false,
    hasSignatureFields: false,
  },
  {
    path: FIXTURES.cidFont,
    name: 'cid-font.pdf',
    pageCount: 1,
    hasText: true,
    hasTitle: true,
    hasAnnotations: false,
    hasSignatureFields: false,
  },
  {
    path: FIXTURES.imageKinds,
    name: 'image-kinds.pdf',
    pageCount: 1,
    hasText: true,
    hasTitle: true,
    hasAnnotations: false,
    hasSignatureFields: false,
  },
  {
    path: FIXTURES.structured,
    name: 'structured.pdf',
    pageCount: 2,
    hasText: true,
    hasTitle: true,
    hasAnnotations: false,
    hasSignatureFields: false,
  },
  {
    path: FIXTURES.noMetadata,
    name: 'no-metadata.pdf',
    pageCount: 1,
    hasText: true,
    hasTitle: false,
    hasAnnotations: false,
    hasSignatureFields: false,
  },
];

/**
 * Fixtures that `npm run test:fixtures` may legitimately not produce. The tests
 * that read them check for the file themselves and skip.
 */
const OPTIONAL_FIXTURES: ReadonlySet<string> = new Set([
  // made by `qpdf --linearize`; skipped when qpdf is not installed (04-tier2-structure).
  // Under CI the generator stops instead, so this can only be absent on a developer machine.
  FIXTURES.linearized,
]);

/** Paths in FIXTURES that are required but not on disk. */
export function missingFixtures(): string[] {
  return Object.values(FIXTURES).filter((p) => !OPTIONAL_FIXTURES.has(p) && !existsSync(p));
}

/**
 * Stop with the fixture names when a required one is missing.
 *
 * The fixtures are generated (`npm run test:fixtures`) and git-ignored, so a
 * checkout that pulled a commit adding a new fixture keeps passing nothing new
 * until the generator is run again. Without this, the first test to read the
 * missing file failed somewhere else — `summarize` answered with an error body
 * and the test read `undefined` off it (`summary.scope.xmpDeclarations`), which
 * says nothing about a missing file. Run on import so every file that uses
 * FIXTURES stops with the same message.
 */
const missing = missingFixtures();
if (missing.length > 0) {
  const names = missing.map((p) => p.slice(FIXTURES_DIR.length + 1)).join(', ');
  throw new Error(
    `Missing test fixtures in tests/fixtures: ${names}. ` +
      'They are generated and git-ignored — run `npm run test:fixtures` (it rebuilds all of them) and test again.',
  );
}

/** Invalid/non-existent paths for error testing */
export const INVALID_PATHS = {
  nonExistent: '/tmp/nonexistent-pdf-file-12345.pdf',
  emptyString: '',
  relative: 'tests/fixtures/simple.pdf',
  traversal: '/tmp/../etc/passwd',
  notPdf: '/tmp/test-file.txt',
} as const;
