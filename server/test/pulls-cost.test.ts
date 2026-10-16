import { describe, it, expect } from 'vitest';
import { NO_COST, toPrCost } from '../src/modules/pulls/cost.js';
import { toCostUsd } from '../src/db/trace-cost.js';

/**
 * L01 — PR-list cost aggregate, row → API mapping (specs/review-run-cost.md
 * §4.3). The SQL itself is covered by run-cost-api.it.test.ts.
 */
describe('toPrCost', () => {
  it('all done runs priced → the sum, not partial', () => {
    expect(toPrCost({ costUsd: 0.002, doneRuns: 2, pricedRuns: 2 })).toEqual({
      cost_usd: 0.002,
      cost_partial: false,
    });
  });

  it('some done runs unpriced → lower bound, partial', () => {
    expect(toPrCost({ costUsd: 0.001, doneRuns: 2, pricedRuns: 1 })).toEqual({
      cost_usd: 0.001,
      cost_partial: true,
    });
  });

  it('no priced run → unknown (null), partial when there were done runs', () => {
    expect(toPrCost({ costUsd: null, doneRuns: 1, pricedRuns: 0 })).toEqual({
      cost_usd: null,
      cost_partial: true,
    });
  });

  it('a known zero total stays 0, not null', () => {
    expect(toPrCost({ costUsd: 0, doneRuns: 1, pricedRuns: 1 })).toEqual({
      cost_usd: 0,
      cost_partial: false,
    });
  });

  it('a PR without done runs is unknown and not partial', () => {
    expect(NO_COST).toEqual({ cost_usd: null, cost_partial: false });
  });
});

describe('toCostUsd', () => {
  it('keeps null distinct from 0 and normalises numeric strings', () => {
    expect(toCostUsd(null)).toBeNull();
    expect(toCostUsd(undefined)).toBeNull();
    expect(toCostUsd(0)).toBe(0);
    expect(toCostUsd('0.001')).toBe(0.001);
    expect(toCostUsd('not a number')).toBeNull();
  });
});
