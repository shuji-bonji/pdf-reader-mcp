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
  noMetadata: resolve(FIXTURES_DIR, 'no-metadata.pdf'),
  corrupted: resolve(FIXTURES_DIR, 'corrupted.pdf'),
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
    path: FIXTURES.noMetadata,
    name: 'no-metadata.pdf',
    pageCount: 1,
    hasText: true,
    hasTitle: false,
    hasAnnotations: false,
    hasSignatureFields: false,
  },
];

/** Check that all fixture files exist */
export function checkFixtures(): boolean {
  return ALL_FIXTURES.every((f) => existsSync(f.path));
}

/** Invalid/non-existent paths for error testing */
export const INVALID_PATHS = {
  nonExistent: '/tmp/nonexistent-pdf-file-12345.pdf',
  emptyString: '',
  relative: 'tests/fixtures/simple.pdf',
  traversal: '/tmp/../etc/passwd',
  notPdf: '/tmp/test-file.txt',
} as const;
