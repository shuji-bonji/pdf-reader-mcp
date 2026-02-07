/**
 * E2E Test Helpers
 *
 * - Performance measurement
 * - Assertion helpers
 * - Baseline tracking
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ========================================
// パフォーマンス計測
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
// パフォーマンスベースライン
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
 * 前回のベースラインを読み込む
 */
export function loadBaseline(): Baseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Baseline;
  } catch {
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
}

/**
 * 前回ベースラインとの比較で ±20% 超の劣化がないかチェック
 */
export function checkRegression(
  operation: string,
  currentMs: number,
  threshold = 0.2,
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

// ========================================
// アサーションヘルパー
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
