/**
 * Run `worker` over `items` with at most `limit` calls in flight. Items start
 * in input order (a free slot always takes the next item), so with a cap of N
 * the first N items run first. Never rejects: every item settles, and the
 * result array keeps input order. In-repo on purpose — no p-limit dependency.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`mapWithConcurrency: limit must be a positive integer, got ${limit}`);
  }
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  // Each lane pulls the next index until the list is drained. JS is
  // single-threaded, so `next++` cannot hand the same index to two lanes.
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await worker(items[i]!, i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}
