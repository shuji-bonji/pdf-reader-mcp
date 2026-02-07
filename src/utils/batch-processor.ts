/**
 * Batch processing utility for large PDFs.
 *
 * Processes pages in configurable batches to balance parallelism
 * with memory usage. Within each batch, pages are processed in
 * parallel using Promise.all. Batches run sequentially to avoid
 * excessive memory consumption on large documents.
 */

/** Default batch size — balances parallelism and memory */
export const DEFAULT_BATCH_SIZE = 10;

/**
 * Process an array of items in parallel batches.
 *
 * @param items       Array of items to process (e.g., page numbers).
 * @param processor   Async function that processes a single item and returns a result.
 * @param batchSize   Number of items to process concurrently in each batch.
 * @returns           Array of results in the same order as the input items.
 *
 * @example
 * ```ts
 * const pageTexts = await processInBatches(
 *   [1, 2, 3, ..., 200],
 *   async (pageNum) => {
 *     const page = await doc.getPage(pageNum);
 *     return extractPageText(page);
 *   },
 *   10, // 10 pages at a time
 * );
 * ```
 */
export async function processInBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<R[]> {
  const results: R[] = [];
  const effectiveBatchSize = Math.max(1, batchSize);

  for (let i = 0; i < items.length; i += effectiveBatchSize) {
    const batch = items.slice(i, i + effectiveBatchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Process items in parallel batches and reduce into a single value.
 *
 * Useful when each item produces a partial result that must be merged
 * (e.g., per-page image counts summed into a total).
 *
 * @param items       Array of items to process.
 * @param processor   Async function that processes a single item.
 * @param reducer     Function that merges two results into one.
 * @param initial     Initial value for the reduction.
 * @param batchSize   Number of items to process concurrently in each batch.
 * @returns           The fully reduced result.
 *
 * @example
 * ```ts
 * const totalImages = await processAndReduce(
 *   pageNumbers,
 *   async (pageNum) => {
 *     const page = await doc.getPage(pageNum);
 *     const ops = await page.getOperatorList();
 *     return ops.fnArray.filter(op => op === OPS.paintImageXObject).length;
 *   },
 *   (sum, count) => sum + count,
 *   0,
 * );
 * ```
 */
export async function processAndReduce<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  reducer: (acc: R, current: R) => R,
  initial: R,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<R> {
  const results = await processInBatches(items, processor, batchSize);
  return results.reduce(reducer, initial);
}
