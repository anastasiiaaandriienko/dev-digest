import { sql, type SQL } from 'drizzle-orm';
import * as t from './schema.js';

/**
 * L01 run cost, read back from the run's trace document
 * (`run_traces.trace.stats.cost_usd`, specs/review-run-cost.md §2, §4).
 *
 * Lives next to the schema (like `rows.ts`) so the reviews and pulls modules
 * share ONE spelling of the jsonb path instead of each hard-coding it.
 * `->>` yields SQL NULL for a missing key (old traces) and for JSON null
 * (unknown cost), and casting NULL is safe; a LEFT JOIN with no trace row
 * also yields NULL. Only the run executor writes this field, always as a
 * number or null, so the `float8` cast cannot fail on stored data.
 */
export function traceCostUsd(): SQL<number | null> {
  return sql<number | null>`(${t.runTraces.trace} -> 'stats' ->> 'cost_usd')::float8`;
}

/** postgres-js returns float8 as a number; normalise defensively, keeping null ≠ 0. */
export function toCostUsd(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
