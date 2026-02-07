/**
 * Unit tests for batch-processor utility.
 */
import { describe, expect, it } from 'vitest';
import { processInBatches, processAndReduce } from '../../src/utils/batch-processor.js';

describe('processInBatches', () => {
  it('processes all items and preserves order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await processInBatches(items, async (n) => n * 2, 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('handles batch size larger than items', async () => {
    const items = [10, 20];
    const results = await processInBatches(items, async (n) => n + 1, 100);
    expect(results).toEqual([11, 21]);
  });

  it('handles batch size of 1 (sequential)', async () => {
    const items = ['a', 'b', 'c'];
    const results = await processInBatches(items, async (s) => s.toUpperCase(), 1);
    expect(results).toEqual(['A', 'B', 'C']);
  });

  it('handles empty array', async () => {
    const results = await processInBatches([], async (n: number) => n, 5);
    expect(results).toEqual([]);
  });

  it('processes items within a batch concurrently', async () => {
    const order: number[] = [];
    const items = [1, 2, 3, 4];
    await processInBatches(
      items,
      async (n) => {
        // Items within a batch should start "simultaneously"
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(n);
        return n;
      },
      4,
    );
    // All items in one batch — order may vary but all should be present
    expect(order.sort()).toEqual([1, 2, 3, 4]);
  });

  it('processes batches sequentially', async () => {
    const batchOrder: number[] = [];
    const items = [1, 2, 3, 4];
    await processInBatches(
      items,
      async (n) => {
        batchOrder.push(n);
        return n;
      },
      2,
    );
    // Batch 1: [1,2], Batch 2: [3,4] — items within batch may vary
    // but batch 1 items should all come before batch 2 items
    expect(batchOrder.indexOf(1)).toBeLessThan(batchOrder.indexOf(3));
    expect(batchOrder.indexOf(2)).toBeLessThan(batchOrder.indexOf(4));
  });
});

describe('processAndReduce', () => {
  it('sums numbers correctly', async () => {
    const items = [1, 2, 3, 4, 5];
    const total = await processAndReduce(
      items,
      async (n) => n * 10,
      (a, b) => a + b,
      0,
      2,
    );
    expect(total).toBe(150);
  });

  it('concatenates strings', async () => {
    const items = ['hello', ' ', 'world'];
    const result = await processAndReduce(
      items,
      async (s) => s,
      (a, b) => a + b,
      '',
      2,
    );
    expect(result).toBe('hello world');
  });

  it('handles empty array with initial value', async () => {
    const result = await processAndReduce(
      [] as number[],
      async (n) => n,
      (a, b) => a + b,
      42,
    );
    expect(result).toBe(42);
  });

  it('merges objects', async () => {
    const items = [{ a: 1 }, { b: 2 }, { c: 3 }];
    const result = await processAndReduce(
      items,
      async (obj) => obj,
      (acc, obj) => ({ ...acc, ...obj }),
      {} as Record<string, number>,
      2,
    );
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });
});
