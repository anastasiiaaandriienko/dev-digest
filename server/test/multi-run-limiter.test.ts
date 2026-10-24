import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../src/modules/reviews/concurrency.js';

/** A promise the test resolves/rejects by hand. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let pending microtasks (lane hand-offs) run. */
const flush = () => new Promise<void>((r) => setImmediate(r));

describe('mapWithConcurrency (L07 T2)', () => {
  it('never runs more than `limit` workers at once and starts items in input order', async () => {
    const gates = Array.from({ length: 6 }, () => deferred());
    const started: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const done = mapWithConcurrency([0, 1, 2, 3, 4, 5], 4, async (n) => {
      started.push(n);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gates[n]!.promise;
      inFlight--;
      return n;
    });

    await flush();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[2]!.resolve();
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]); // the 5th takes the freed slot

    for (const g of gates) g.resolve();
    await done;
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxInFlight).toBe(4);
  });

  it('returns settled results in input order, not completion order', async () => {
    const delays = [30, 5, 20, 1];
    const results = await mapWithConcurrency(delays, 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `item-${i}`;
    });
    expect(results).toEqual([
      { status: 'fulfilled', value: 'item-0' },
      { status: 'fulfilled', value: 'item-1' },
      { status: 'fulfilled', value: 'item-2' },
      { status: 'fulfilled', value: 'item-3' },
    ]);
  });

  it('isolates a rejecting item: the others still run and the call itself resolves', async () => {
    const seen: number[] = [];
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
      if (n === 2) throw new Error('agent 2 failed');
      return n * 10;
    });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(results[1]).toEqual({ status: 'rejected', reason: new Error('agent 2 failed') });
    expect(results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<number>).value)).toEqual([
      10, 30, 40, 50,
    ]);
  });

  it('handles an empty list and a limit larger than the list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    let maxInFlight = 0;
    let inFlight = 0;
    await mapWithConcurrency([1, 2], 4, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await flush();
      inFlight--;
    });
    expect(maxInFlight).toBe(2);
  });

  it('rejects a non-positive or fractional limit', async () => {
    await expect(mapWithConcurrency([1], 0, async () => 1)).rejects.toThrow(RangeError);
    await expect(mapWithConcurrency([1], 1.5, async () => 1)).rejects.toThrow(RangeError);
  });
});
