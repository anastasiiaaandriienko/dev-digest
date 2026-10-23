import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const mutate = vi.fn();
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useFindingAction: () => ({ mutate, isPending: false }),
  useFindingDecisionStatus: () => new Map(),
}));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

function finding(id: string, severity: FindingRecord["severity"], title: string): FindingRecord {
  return {
    id,
    severity,
    category: "security",
    title,
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "Why it matters.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  };
}

const FINDINGS: FindingRecord[] = [
  finding("c1", "CRITICAL", "Hardcoded secret"),
  finding("c2", "CRITICAL", "SQL injection"),
  finding("w1", "WARNING", "Missing null check"),
];

function review(findings: FindingRecord[]): ReviewRecord {
  return {
    id: "r1",
    pr_id: "pr1",
    agent_id: "a1",
    run_id: "run1",
    agent_name: "Security reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: "Two blockers.",
    score: 40,
    model: "test-model",
    grounding: null,
    created_at: "2026-10-11T10:00:00.000Z",
    findings,
  };
}

function renderAccordion(findings: FindingRecord[] = FINDINGS, defaultOpen = true, over: Partial<ReviewRecord> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <ReviewRunAccordion review={{ ...review(findings), ...over }} prId="pr1" defaultOpen={defaultOpen} />
    </NextIntlClientProvider>,
  );
}

const pills = () => within(screen.getByRole("group", { name: messages.severity.filterLabel }));
const pill = (label: string) => pills().getByRole("button", { name: label });
const allPill = () => pills().getByRole("button", { name: /^All/ });
const titles = () =>
  ["Hardcoded secret", "SQL injection", "Missing null check"].filter((t) => screen.queryByText(t));

describe("ReviewRunAccordion — severity pills in the expanded run card", () => {
  it("shows no pills while collapsed, and N CRITICAL / N WARNING / N SUGGESTION once expanded", () => {
    renderAccordion(FINDINGS, false);
    expect(screen.queryByRole("group", { name: messages.severity.filterLabel })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Security reviewer"));

    expect(pill("2 CRITICAL")).toBeInTheDocument();
    expect(pill("1 WARNING")).toBeInTheDocument();
    expect(pill("0 SUGGESTION")).toBeInTheDocument();
    expect(allPill()).toHaveTextContent("3");
    expect(allPill()).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a pill filters the run's findings and marks the pill active", () => {
    renderAccordion();
    fireEvent.click(pill("1 WARNING"));

    expect(titles()).toEqual(["Missing null check"]);
    expect(pill("1 WARNING")).toHaveAttribute("aria-pressed", "true");
    expect(allPill()).toHaveAttribute("aria-pressed", "false");
    // Counts stay over ALL findings while filtered.
    expect(pill("2 CRITICAL")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 3 findings");

    fireEvent.click(pill("1 WARNING"));
    fireEvent.click(pill("2 CRITICAL"));
    expect(titles()).toEqual(["Hardcoded secret", "SQL injection"]);
  });

  it("All resets the filter and shows every finding again", () => {
    renderAccordion();
    fireEvent.click(pill("2 CRITICAL"));
    expect(titles()).toHaveLength(2);

    fireEvent.click(allPill());
    expect(titles()).toHaveLength(3);
    expect(allPill()).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("an empty filtered result shows the no-match state with a way back", () => {
    renderAccordion();
    fireEvent.click(pill("0 SUGGESTION"));

    expect(titles()).toEqual([]);
    expect(screen.getByText(messages.panel.noMatchTitle)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: messages.panel.showAll })[0]!);
    expect(titles()).toHaveLength(3);
  });

  it("a run with zero findings shows zero-count pills and 'No findings'", () => {
    renderAccordion([]);
    expect(pill("0 CRITICAL")).toBeInTheDocument();
    expect(pill("0 WARNING")).toBeInTheDocument();
    expect(pill("0 SUGGESTION")).toBeInTheDocument();
    expect(screen.getByText(messages.panel.noFindingsTitle)).toBeInTheDocument();
    expect(screen.queryByText(messages.panel.noMatchTitle)).not.toBeInTheDocument();
  });

  it("Accept / Reject still act on the finding shown under an active filter", () => {
    renderAccordion();
    fireEvent.click(pill("1 WARNING"));
    // The card keeps its own expanded state across filtering: open it to reach its actions.
    fireEvent.click(screen.getByText("Missing null check"));

    fireEvent.click(screen.getByRole("button", { name: messages.finding.accept }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ findingId: "w1", action: "accept", prId: "pr1" });

    fireEvent.click(screen.getByRole("button", { name: messages.finding.dismiss }));
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenLastCalledWith({ findingId: "w1", action: "dismiss", prId: "pr1" });
  });
});

describe("ReviewRunAccordion — eval case action (L06, D-2)", () => {
  const decided = [{ ...FINDINGS[0]!, accepted_at: "t" }];
  const turnInto = () => screen.queryByRole("button", { name: messages.finding.evalCase.turnInto });

  it("offers Turn into eval case for a review of an existing agent", () => {
    renderAccordion(decided);
    expect(turnInto()).toBeTruthy();
  });

  it("hides it when the agent no longer exists (agent_id set, agent_name null)", () => {
    renderAccordion(decided, true, { agent_name: null });
    expect(turnInto()).toBeNull();
  });
});
