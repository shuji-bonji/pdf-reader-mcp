/**
 * E2E Test Helpers
 *
 * パフォーマンス計測・ベースライン管理・アサーションヘルパー
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGRESSION_THRESHOLD } from './constants.js';

// ========================================
// Performance measurement
// ========================================

export interface TimingResult<T> {
  result: T;
  durationMs: number;
}

/**
 * 関数の実行時間を計測して返す
 */
export async function withTiming<T>(fn: () => Promise<T>): Promise<TimingResult<T>> {
  const start = performance.now();
  const result = await fn();
  const durationMs = Math.round(performance.now() - start);
  return { result, durationMs };
}

// ========================================
// Performance baseline
// ========================================

interface BaselineEntry {
  operation: string;
  durationMs: number;
  timestamp: string;
}

interface Baseline {
  version: string;
  entries: BaselineEntry[];
}

const BASELINE_PATH = join(process.cwd(), 'tests', 'e2e', 'baseline.json');
const performanceEntries: BaselineEntry[] = [];

/** ベースラインキャッシュ（同一テスト実行内で1回だけ読む） */
let cachedBaseline: Baseline | null | undefined;

/**
 * パフォーマンス計測結果を記録する
 */
export function recordPerformance(operation: string, durationMs: number): void {
  performanceEntries.push({
    operation,
    durationMs,
    timestamp: new Date().toISOString(),
  });
}

/**
 * 前回のベースラインを読み込む（キャッシュあり）
 */
export function loadBaseline(): Baseline | null {
  if (cachedBaseline !== undefined) return cachedBaseline;
  if (!existsSync(BASELINE_PATH)) {
    cachedBaseline = null;
    return null;
  }
  try {
    cachedBaseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Baseline;
    return cachedBaseline;
  } catch {
    cachedBaseline = null;
    return null;
  }
}

/**
 * 現在の計測結果をベースラインとして保存する
 */
export function saveBaseline(): void {
  const baseline: Baseline = {
    version: '0.2.0',
    entries: performanceEntries,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf-8');
  // キャッシュを無効化（次回テスト実行時に再読み込み）
  cachedBaseline = undefined;
}

/**
 * 前回ベースラインとの比較で劣化がないかチェック
 */
export function checkRegression(
  operation: string,
  currentMs: number,
  threshold = REGRESSION_THRESHOLD,
): { regressed: boolean; baselineMs?: number; changePercent?: number } {
  const baseline = loadBaseline();
  if (!baseline) return { regressed: false };

  const prev = baseline.entries.find((e) => e.operation === operation);
  if (!prev) return { regressed: false };

  const changePercent = (currentMs - prev.durationMs) / prev.durationMs;
  return {
    regressed: changePercent > threshold,
    baselineMs: prev.durationMs,
    changePercent: Math.round(changePercent * 100),
  };
}

/**
 * パフォーマンス計測＋記録＋回帰チェックを1関数で行うヘルパー
 */
export async function measureAndCheck(
  operation: string,
  fn: () => Promise<unknown>,
  thresholdMs: number,
): Promise<number> {
  const { durationMs } = await withTiming(fn);
  recordPerformance(operation, durationMs);

  const regression = checkRegression(operation, durationMs);
  if (regression.regressed) {
    console.warn(
      `⚠️ Performance regression in ${operation}: ${regression.baselineMs}ms → ${durationMs}ms (${regression.changePercent}%)`,
    );
  }

  expect(durationMs).toBeLessThan(thresholdMs);
  return durationMs;
}

// ========================================
// Assertion helpers
// ========================================

/**
 * 値が指定範囲内にあることをアサート
 */
export function expectInRange(value: number, min: number, max: number, label?: string): void {
  const msg = label ? `${label}: ${value} is not in range [${min}, ${max}]` : undefined;
  expect(value).toBeGreaterThanOrEqual(min);
  expect(value).toBeLessThanOrEqual(max);
  if (msg && (value < min || value > max)) {
    throw new Error(msg);
  }
}

/**
 * エラーメッセージが期待する部分文字列を含むことを検証
 */
export async function expectError(
  fn: () => Promise<unknown>,
  expectedSubstring: string,
): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected error containing "${expectedSubstring}" but no error was thrown`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    expect(message.toLowerCase()).toContain(expectedSubstring.toLowerCase());
  }
}

/**
 * オブジェクトの各フィールドが指定された型であることを検証
 */
export function expectFieldTypes(
  obj: Record<string, unknown>,
  typeMap: Record<string, string>,
): void {
  for (const [key, expectedType] of Object.entries(typeMap)) {
    expect(typeof obj[key]).toBe(expectedType);
  }
}
