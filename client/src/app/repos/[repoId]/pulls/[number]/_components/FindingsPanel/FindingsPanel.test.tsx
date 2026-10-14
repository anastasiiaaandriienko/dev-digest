import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const mutate = vi.fn();
let decisions = new Map<string, "pending" | "error" | "success">();
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate, isPending: false }),
  useFindingDecisionStatus: () => decisions,
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(() => {
  cleanup();
  mutate.mockClear();
  decisions = new Map();
});

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("a review with zero findings says so (not 'no match'), with zero counts", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText(messages.panel.noFindingsTitle)).toBeInTheDocument();
    expect(screen.queryByText(messages.panel.noMatchTitle)).not.toBeInTheDocument();
    expect(chip("All")).toHaveTextContent("0");
    expect(chip("CRITICAL")).toHaveTextContent("0");
  });
});

// ---- L01 severity counts + filters (client spec §3, S2) --------------------

function finding(id: string, severity: FindingRecord["severity"], o: Partial<FindingRecord> = {}): FindingRecord {
  return { ...FINDINGS[0]!, id, severity, title: `${severity} ${id}`, ...o };
}

const MIXED: FindingRecord[] = [
  finding("c1", "CRITICAL"),
  finding("w1", "WARNING"),
  finding("c2", "CRITICAL", { confidence: 0.4 }),
];

/** The chip for a severity key ("All" for the reset chip). */
function chip(key: string): HTMLElement {
  if (key === "All") return screen.getByRole("button", { name: /^All/ });
  return document.querySelector(`button[data-severity="${key}"]`) as HTMLElement;
}

const titles = () => screen.queryAllByText(/^(CRITICAL|WARNING|SUGGESTION) /).map((el) => el.textContent);

describe("FindingsPanel — severity chips", () => {
  it("shows a count per severity over all findings, plus the total", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    expect(chip("All")).toHaveTextContent("3");
    expect(chip("CRITICAL")).toHaveTextContent("2");
    expect(chip("WARNING")).toHaveTextContent("1");
    expect(chip("SUGGESTION")).toHaveTextContent("0");
    expect(document.querySelector('button[data-severity="INFO"]')).toBeNull();
    expect(chip("All")).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a chip filters the list; counts stay stable; All resets", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    fireEvent.click(chip("WARNING"));
    expect(titles()).toEqual(["WARNING w1"]);
    expect(chip("WARNING")).toHaveAttribute("aria-pressed", "true");
    expect(chip("All")).toHaveAttribute("aria-pressed", "false");
    expect(chip("CRITICAL")).toHaveTextContent("2");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 3 findings");

    // Multi-select: add CRITICAL.
    fireEvent.click(chip("CRITICAL"));
    expect(titles()).toEqual(["CRITICAL c1", "CRITICAL c2", "WARNING w1"]);

    fireEvent.click(chip("All"));
    expect(titles()).toHaveLength(3);
    expect(chip("All")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("combines with hide-low-confidence (AND)", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    fireEvent.click(chip("CRITICAL"));
    fireEvent.click(screen.getByRole("switch"));
    expect(titles()).toEqual(["CRITICAL c1"]);
  });

  it("an empty selection shows the no-match state with a way back to all findings", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    fireEvent.click(chip("SUGGESTION"));
    expect(screen.getByText(messages.panel.noMatchTitle)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: messages.panel.showAll })[0]!);
    expect(titles()).toHaveLength(3);
  });

  it("keyboard j/k/a act on the FILTERED list and stay in range", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    fireEvent.click(chip("WARNING"));
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).toHaveBeenLastCalledWith({ findingId: "w1", action: "accept", prId: "pr1" });

    // Filter to nothing: j must not move out of range, a must not act.
    mutate.mockClear();
    fireEvent.click(chip("WARNING"));
    fireEvent.click(chip("SUGGESTION"));
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).not.toHaveBeenCalled();
  });
});

// ---- L01 Accept / Reject (client spec §5, A2) ------------------------------

describe("FindingsPanel — decisions", () => {
  it("A2: with two panels mounted, one key press decides exactly one finding", () => {
    renderWithIntl(
      <>
        <FindingsPanel findings={[finding("p1", "CRITICAL")]} prId="pr1" />
        <FindingsPanel findings={[finding("p2", "CRITICAL")]} prId="pr1" />
      </>,
    );
    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenLastCalledWith({ findingId: "p1", action: "accept", prId: "pr1" });

    // Interacting with the second panel moves keyboard ownership to it.
    const panels = screen.getAllByTestId("findings-panel");
    fireEvent.pointerDown(panels[1]!);
    fireEvent.keyDown(window, { key: "d" });
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenLastCalledWith({ findingId: "p2", action: "dismiss", prId: "pr1" });
  });

  it("clicking Reject sends the server's dismiss action for that finding", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    // The first (expanded) card is the top-severity one.
    fireEvent.click(screen.getAllByRole("button", { name: messages.finding.dismiss })[0]!);
    expect(mutate).toHaveBeenCalledWith({ findingId: "c1", action: "dismiss", prId: "pr1" });
  });

  it("a decision the finding already has is not re-sent (no undo)", () => {
    renderWithIntl(<FindingsPanel findings={[finding("x", "CRITICAL", { accepted_at: "t" })]} prId="pr1" />);
    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "d" });
    expect(mutate).toHaveBeenCalledWith({ findingId: "x", action: "dismiss", prId: "pr1" });
  });

  it("while a finding's decision is pending, keys and its buttons are blocked; other cards are not", () => {
    decisions = new Map([["c1", "pending"]]);
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(messages.finding.decision.pending)).toBeInTheDocument();
    // Move to the next finding (not pending): the key acts.
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("an error status is shown on the card that failed", () => {
    decisions = new Map([["c1", "error"]]);
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    expect(screen.getByText(messages.finding.decision.error)).toBeInTheDocument();
  });
});
