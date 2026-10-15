/**
 * PRRow — L01 cost cell (client spec §1, C2). The value is the PR's total over
 * successful runs; unknown reads "—", a lower bound reads "≥ $x".
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@/lib/types";
import messages from "../../../../../../../messages/en/prReview.json";
import { COLUMN_KEYS, GRID } from "../../constants";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
// The row's findings indicator fetches lazily (only when opened); never here.
const usePrReviews = vi.fn((_prId: string | null) => ({ data: undefined, isLoading: false, isError: false }));
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: (prId: string | null) => usePrReviews(prId),
}));

import { PRRow } from "./PRRow";

afterEach(cleanup);

function pr(o: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting",
    author: "marisa.koch",
    branch: "feat/rl",
    base: "main",
    head_sha: "a1b2c3d4",
    additions: 10,
    deletions: 2,
    files_count: 1,
    status: "reviewed",
    opened_at: null,
    updated_at: null,
    score: 80,
    cost_usd: null,
    cost_partial: false,
    ...o,
  };
}

function renderRow(p: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={p} repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — L01 cost cell", () => {
  it("shows the total of successful runs", () => {
    renderRow(pr({ cost_usd: 0.42, cost_partial: false }));
    const cell = screen.getByText("$0.42");
    expect(cell).toHaveAttribute("title", messages.list.costHint);
  });

  it("shows — when the cost is unknown (null)", () => {
    renderRow(pr({ cost_usd: null, cost_partial: false }));
    const cell = screen.getByTitle(messages.list.costUnknownHint);
    expect(cell).toHaveTextContent("—");
  });

  it("shows — when the API omitted the field (older server)", () => {
    const { cost_usd: _c, cost_partial: _p, ...legacy } = pr();
    renderRow(legacy as PrMeta);
    expect(screen.getByTitle(messages.list.costUnknownHint)).toHaveTextContent("—");
  });

  it("shows a lower bound with ≥ when some runs have no known cost", () => {
    renderRow(pr({ cost_usd: 0.42, cost_partial: true }));
    expect(screen.getByText("≥ $0.42")).toHaveAttribute("title", messages.list.costPartialHint);
  });

  it("shows a known zero as $0.00, not —", () => {
    renderRow(pr({ cost_usd: 0, cost_partial: false }));
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it("keeps 3 significant digits for tiny totals", () => {
    renderRow(pr({ cost_usd: 0.001234 }));
    expect(screen.getByText("$0.00123")).toBeInTheDocument();
  });

  it("renders the findings indicator without fetching anything", () => {
    renderRow(pr());
    expect(screen.getByTestId("findings-indicator")).toHaveTextContent(messages.list.findings.short);
    expect(usePrReviews.mock.calls.every(([id]) => id === null)).toBe(true);
  });
});

describe("PR list columns", () => {
  it("has a Cost column right after Score, with an i18n header", () => {
    expect(COLUMN_KEYS.slice(COLUMN_KEYS.indexOf("score"), COLUMN_KEYS.indexOf("score") + 2)).toEqual([
      "score",
      "cost",
    ]);
    const columns = messages.list.columns as Record<string, string>;
    for (const key of COLUMN_KEYS) expect(columns[key]).toBeTruthy();
    expect(columns.cost).toBe("Cost");
    // Header and rows share GRID: one track per column.
    expect(GRID.trim().split(/\s+/)).toHaveLength(COLUMN_KEYS.length);
  });
});
