/**
 * 06 - Tier 3 Validation E2E Tests
 *
 * VT-1〜VT-4: validate_tagged
 * VM-1〜VM-4: validate_metadata
 */
import { describe, expect, it } from 'vitest';
import { validateMetadata, validateTagged } from '../../src/services/validation-service.js';
import { VALIDATION } from './constants.js';
import { FIXTURES } from './setup.js';

// ========================================
// Tag validation (validate_tagged)
// ========================================

describe('06 - validate_tagged', () => {
  // VT-1: tagged.pdf
  it('VT-1: tagged.pdf isTagged=true with expected checks', async () => {
    const result = await validateTagged(FIXTURES.tagged);
    expect(result.isTagged).toBe(true);
    expect(result.totalChecks).toBe(VALIDATION.taggedTotalChecks);
    // タグ付きPDFとして最低限の構造あり
    expect(result.passed).toBeGreaterThanOrEqual(1);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  // VT-2: simple.pdf (非タグ)
  it('VT-2: simple.pdf isTagged=false with TAG-001 error', async () => {
    const result = await validateTagged(FIXTURES.simple);
    expect(result.isTagged).toBe(false);
    expect(result.failed).toBeGreaterThan(0);
    const tag001 = result.issues.find((i) => i.code === 'TAG-001' && i.severity === 'error');
    expect(tag001).toBeDefined();
    expect(tag001?.message).toContain('not tagged');
  });

  // VT-3: issues の構造
  it('VT-3: issue structure is valid', async () => {
    const result = await validateTagged(FIXTURES.tagged);
    for (const issue of result.issues) {
      expect(typeof issue.severity).toBe('string');
      expect(VALIDATION.validSeverities).toContain(issue.severity);
      expect(typeof issue.code).toBe('string');
      expect(issue.code).toMatch(VALIDATION.tagCheckPattern);
      expect(typeof issue.message).toBe('string');
    }
  });

  // VT-4: summary 生成
  it('VT-4: summary is non-empty and descriptive', async () => {
    const result = await validateTagged(FIXTURES.tagged);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary).toMatch(/check|pass|warn|error/i);
  });

  // VT-extra: 非タグPDF は totalChecks=1 (即座にリターン)
  it('VT-extra: non-tagged PDF has totalChecks=1', async () => {
    const result = await validateTagged(FIXTURES.simple);
    expect(result.totalChecks).toBe(1);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(1);
  });

  // VT-extra: empty.pdf
  it('VT-extra: empty.pdf isTagged=false', async () => {
    const result = await validateTagged(FIXTURES.empty);
    expect(result.isTagged).toBe(false);
  });
});

// ========================================
// Metadata validation (validate_metadata)
// ========================================

describe('06 - validate_metadata', () => {
  // VM-1: simple.pdf (メタデータ完備)
  it('VM-1: simple.pdf passes with complete metadata', async () => {
    const result = await validateMetadata(FIXTURES.simple);
    expect(result.totalChecks).toBe(VALIDATION.metadataTotalChecks);
    expect(result.passed).toBeGreaterThanOrEqual(5);
    expect(result.metadata.hasTitle).toBe(true);
    expect(result.metadata.hasAuthor).toBe(true);
    expect(result.metadata.hasSubject).toBe(true);
  });

  // VM-2: no-metadata.pdf
  it('VM-2: no-metadata.pdf has failures and warnings', async () => {
    const result = await validateMetadata(FIXTURES.noMetadata);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.warnings).toBeGreaterThan(0);
    expect(result.metadata.hasTitle).toBe(false);
    expect(result.metadata.hasAuthor).toBe(false);
  });

  // VM-3: 全チェックコード META-001〜META-010
  it('VM-3: all META-001 through META-010 codes present', async () => {
    const result = await validateMetadata(FIXTURES.simple);
    const codes = result.issues.map((i) => i.code);
    for (const expectedCode of VALIDATION.metadataCheckCodes) {
      expect(codes).toContain(expectedCode);
    }
  });

  // VM-4: metadata フラグの正確性
  it('VM-4: metadata flags are boolean', async () => {
    const result = await validateMetadata(FIXTURES.simple);
    const booleanFields = [
      'hasTitle',
      'hasAuthor',
      'hasSubject',
      'hasKeywords',
      'hasCreator',
      'hasProducer',
      'hasCreationDate',
      'hasModificationDate',
      'isTagged',
    ];
    for (const field of booleanFields) {
      expect(typeof result.metadata[field]).toBe('boolean');
    }
  });

  // VM-extra: tagged.pdf の検証
  it('VM-extra: tagged.pdf metadata validation', async () => {
    const result = await validateMetadata(FIXTURES.tagged);
    expect(result.metadata.hasTitle).toBe(true);
    expect(result.metadata.isTagged).toBe(true);
  });

  // VM-extra: summary の生成
  it('VM-extra: summary is non-empty', async () => {
    const result = await validateMetadata(FIXTURES.simple);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary).toMatch(/check|pass|warn/i);
  });

  // VM-extra: issues の severity 分布
  it('VM-extra: severity distribution matches totals', async () => {
    const result = await validateMetadata(FIXTURES.simple);
    const errorCount = result.issues.filter((i) => i.severity === 'error').length;
    const warnCount = result.issues.filter((i) => i.severity === 'warning').length;
    const infoCount = result.issues.filter((i) => i.severity === 'info').length;

    expect(result.failed).toBe(errorCount);
    expect(result.warnings).toBe(warnCount);
    expect(result.passed).toBe(infoCount);
    expect(result.totalChecks).toBe(errorCount + warnCount + infoCount);
  });
});
