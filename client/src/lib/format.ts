/* lib/format.ts — shared display formatters. */

/** Minimum significant digits kept for a nonzero amount below $1. */
export const COST_MIN_SIGNIFICANT_DIGITS = 3;

/** Shown when a cost is unknown (null / missing) in lists. */
export const COST_UNKNOWN = "—";

export interface FormatCostOptions {
  /** The figure is a lower bound (some runs have no known cost) → "≥ $x". */
  partial?: boolean;
  /** Label for an unknown cost; defaults to "—" (lists). The trace passes "n/a". */
  unknown?: string;
}

const usdFormatters = new Map<number, Intl.NumberFormat>();

function usd(maxFractionDigits: number): Intl.NumberFormat {
  let f = usdFormatters.get(maxFractionDigits);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: maxFractionDigits,
    });
    usdFormatters.set(maxFractionDigits, f);
  }
  return f;
}

/**
 * Fraction digits so a nonzero amount below $1 keeps at least three
 * significant digits (0.001234 → 5 → "$0.00123"); never fewer than the usual
 * two cents. Amounts of $1 or more already carry three with two decimals.
 */
function costFractionDigits(abs: number): number {
  if (abs === 0 || abs >= 1) return 2;
  const magnitude = Math.floor(Math.log10(abs));
  return Math.min(20, Math.max(2, COST_MIN_SIGNIFICANT_DIGITS - 1 - magnitude));
}

/**
 * Format a run / PR cost in USD. One formatter for every cost surface (PR list,
 * run timeline, Trace drawer) so unknown and zero never get confused:
 *   - null / undefined / non-finite → unknown ("—", or `opts.unknown`);
 *   - 0 → "$0.00" (a known zero, e.g. a free model);
 *   - 0 < x < 1 → at least 3 significant digits, trailing zeros trimmed down to
 *     two decimals: 0.001 → "$0.001", 0.001234 → "$0.00123", 0.4234 → "$0.423",
 *     0.42 → "$0.42";
 *   - x ≥ 1 → two decimals: "$1.23", "$1,234.50";
 *   - `partial` → "≥ " prefix on a known figure.
 */
export function formatCost(usdAmount: number | null | undefined, opts: FormatCostOptions = {}): string {
  if (usdAmount == null || !Number.isFinite(usdAmount)) return opts.unknown ?? COST_UNKNOWN;
  const text = usd(costFractionDigits(Math.abs(usdAmount))).format(usdAmount);
  return opts.partial ? `≥ ${text}` : text;
}
