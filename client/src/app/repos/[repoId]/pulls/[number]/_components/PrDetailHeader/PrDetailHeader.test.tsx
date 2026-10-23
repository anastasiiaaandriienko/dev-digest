import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import multiAgent from "../../../../../../../../messages/en/multiAgent.json";
import type { PrDetail } from "@/lib/types";

/**
 * L07 T8 — PR header: the Results link exists only with a multi-run (AC-MAR-27),
 * and the existing actions (View on GitHub, Run Review, tabs) stay.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

let multiRun: unknown = null;
vi.mock("@/lib/hooks/multi-agent", () => ({
  useMultiAgentRun: () => ({ data: { multi_run: multiRun } }),
}));

const pickerProps: unknown[] = [];
vi.mock("../RunReviewDropdown", () => ({
  RunReviewDropdown: (p: unknown) => {
    pickerProps.push(p);
    return <button type="button">Run Review</button>;
  },
}));

import { PrDetailHeader } from "./PrDetailHeader";

const pr = {
  number: 482,
  title: "Add rate limiting",
  author: "marisa",
  branch: "feat/rate",
  base: "main",
  additions: 247,
  deletions: 38,
  status: "open",
  files_count: 9,
} as unknown as PrDetail;

function renderHeader(over: Partial<React.ComponentProps<typeof PrDetailHeader>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent }}>
      <PrDetailHeader
        pr={pr}
        repoId="repo-1"
        prId="pr-1"
        tab="overview"
        findingsCount={3}
        githubUrl="https://github.com/acme/api/pull/482"
        onSetTab={() => undefined}
        onRunStart={() => undefined}
        onRunsStarted={() => undefined}
        {...over}
      />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  push.mockReset();
  pickerProps.length = 0;
  multiRun = null;
});
afterEach(cleanup);

describe("PrDetailHeader", () => {
  it("hides the multi-agent link while the PR has no multi-run", () => {
    renderHeader();
    expect(screen.queryByRole("button", { name: "Multi-agent review" })).not.toBeInTheDocument();
  });

  it("shows a link to the latest multi-run's Results page (AC-MAR-27)", () => {
    multiRun = { id: "multi-1" };
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Multi-agent review" }));
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482/multi-agent");
  });

  it("keeps the existing actions and passes the PR to the picker", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: /View on GitHub/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run Review" })).toBeInTheDocument();
    expect(screen.getByText("Agent runs")).toBeInTheDocument();
    expect(screen.getByText("Files changed")).toBeInTheDocument();
    expect(pickerProps.at(-1)).toMatchObject({ prId: "pr-1", repoId: "repo-1", prNumber: 482, warnMerged: false });
  });

  it("no picker before the PR id is resolved", () => {
    renderHeader({ prId: null });
    expect(screen.queryByRole("button", { name: "Run Review" })).not.toBeInTheDocument();
  });
});
