/**
 * 06 - Tier 3 Validation E2E Tests
 *
 * VT-1〜VT-4: validate_tagged
 * VM-1〜VM-4: validate_metadata
 */
import { describe, expect, it } from 'vitest';
import { validateMetadata, validateTagged } from '../../src/services/validation-service.js';
import { FIXTURES } from './setup.js';

// ========================================
// タグ検証 (validate_tagged)
// ========================================

describe('06 - validate_tagged', () => {
  // VT-1: tagged.pdf
  it('VT-1: tagged.pdf の検証 (isTagged=true)', async () => {
    const result = await validateTagged(FIXTURES.tagged);
    expect(result.isTagged).toBe(true);
    expect(result.totalChecks).toBe(8);
    // エラーが少ないこと (タグ付きPDFとして最低限の構造あり)
    expect(result.passed).toBeGreaterThanOrEqual(1);
    // summary が存在
    expect(result.summary.length).toBeGreaterThan(0);
  });

  // VT-2: simple.pdf (非タグ)
  it('VT-2: simple.pdf で isTagged=false, TAG-001 error', async () => {
    const result = await validateTagged(FIXTURES.simple);
    expect(result.isTagged).toBe(false);
    expect(result.failed).toBeGreaterThan(0);
    // TAG-001 エラーが存在
    const tag001 = result.issues.find((i) => i.code === 'TAG-001' && i.severity === 'error');
    expect(tag001).toBeDefined();
    expect(tag001?.message).toContain('not tagged');
  });

  // VT-3: issues の構造
  it('VT-3: issues の構造が正確', async () => {
    const result = await validateTagged(FIXTURES.tagged);
    for (const issue of result.issues) {
      expect(typeof issue.severity).toBe('string');
      expect(['error', 'warning', 'info']).toContain(issue.severity);
      expect(typeof issue.code).toBe('string');
      expect(issue.code).toMatch(/^TAG-\d{3}$/);
      expect(typeof issue.message).toBe('string');
    }
  });

  // VT-4: summary 生成
  it('VT-4: summary が非空の要約文', async () => {
    const result = await validateTagged(FIXTURES.tagged);
    expect(result.summary.length).toBeGreaterThan(0);
    // "checks" や "passed" などの文言が含まれる
    expect(result.summary).toMatch(/check|pass|warn|error/i);
  });

  // VT-extra: 非タグPDFの totalChecks=1 (即座にリターン)
  it('VT-extra: 非タグPDF は totalChecks=1', async () => {
    const result = await validateTagged(FIXTURES.simple);
    // 非タグPDFは最初のチェック (TAG-001) で即リターン
    expect(result.totalChecks).toBe(1);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(1);
  });

  // VT-extra: empty.pdf
  it('VT-extra: empty.pdf の検証', async () => {
    const result = await validateTagged(FIXTURES.empty);
    expect(result.isTagged).toBe(false);
  });
});

// ========================================
// メタデータ検証 (validate_metadata)
// ========================================

describe('06 - validate_metadata', () => {
  // VM-1: simple.pdf (メタデータ完備)
  it('VM-1: simple.pdf の検証 (メタデータ完備)', async () => {
    const result = await validateMetadata(FIXTURES.simple);
    expect(result.totalChecks).toBe(10);
    // title と author があるので passed 多め
    expect(result.passed).toBeGreaterThanOrEqual(5);
    expect(result.metadata.hasTitle).toBe(true);
    expect(result.metadata.hasAuthor).toBe(true);
    expect(result.metadata.hasSubject).toBe(true);
  });

  // VM-2: no-metadata.pdf
  it('VM-2: no-metadata.pdf の検証 (メタデータなし)', async () => {
    const result = await validateMetadata(FIXTURES.noMetadata);
    // title がないので failed >= 1 (META-001)
    expect(result.failed).toBeGreaterThanOrEqual(1);
    // warnings も多い (author, subject, keywords 等)
    expect(result.warnings).toBeGreaterThan(0);
    expect(result.metadata.hasTitle).toBe(false);
    expect(result.metadata.hasAuthor).toBe(false);
  });

  // VM-3: 全チェックコード META-001〜META-010
  it('VM-3: 全チェックコード META-001〜META-010 が存在', async () => {
    const result = await validateMetadata(FIXTURES.simple);
    const codes = result.issues.map((i) => i.code);
    for (let i = 1; i <= 10; i++) {
      const code = `META-${String(i).padStart(3, '0')}`;
      expect(codes).toContain(code);
    }
  });

  // VM-4: metadata フラグの正確性
  it('VM-4: metadata フラグが正確', async () => {
    const result = await validateMetadata(FIXTURES.simple);
    expect(typeof result.metadata.hasTitle).toBe('boolean');
    expect(typeof result.metadata.hasAuthor).toBe('boolean');
    expect(typeof result.metadata.hasSubject).toBe('boolean');
    expect(typeof result.metadata.hasKeywords).toBe('boolean');
    expect(typeof result.metadata.hasCreator).toBe('boolean');
    expect(typeof result.metadata.hasProducer).toBe('boolean');
    expect(typeof result.metadata.hasCreationDate).toBe('boolean');
    expect(typeof result.metadata.hasModificationDate).toBe('boolean');
    expect(typeof result.metadata.isTagged).toBe('boolean');
  });

  // VM-extra: tagged.pdf の検証
  it('VM-extra: tagged.pdf のメタデータ検証', async () => {
    const result = await validateMetadata(FIXTURES.tagged);
    expect(result.metadata.hasTitle).toBe(true);
    expect(result.metadata.isTagged).toBe(true);
  });

  // VM-extra: summary の生成
  it('VM-extra: summary が非空の要約文', async () => {
    const result = await validateMetadata(FIXTURES.simple);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary).toMatch(/check|pass|warn/i);
  });

  // VM-extra: issues の severity 分布
  it('VM-extra: issues の severity 分布が合計と一致', async () => {
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
