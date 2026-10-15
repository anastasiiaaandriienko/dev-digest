/**
 * PR-list findings popover, opened from the PR row (L01, client spec §4, H1/H2).
 * Data comes lazily from usePrReviews (mocked here); the row itself is PRRow so
 * row navigation vs. popover clicks are tested together.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import type { PrMeta } from "@/lib/types";
import messages from "../../../../../../../messages/en/prReview.json";
import { HOVER_OPEN_DELAY_MS } from "./constants";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

type Q = { data?: ReviewRecord[]; isLoading: boolean; isError: boolean };
let query: Q = { data: undefined, isLoading: false, isError: false };
const usePrReviews = vi.fn((_prId: string | null) => query);
vi.mock("@/lib/hooks/reviews", () => ({ usePrReviews: (prId: string | null) => usePrReviews(prId) }));

import { PRRow } from "../PRRow";
import { latestReview } from "./FindingsPopover";

const L = messages.list.findings;

function f(id: string, severity: FindingRecord["severity"], o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id,
    severity,
    category: "bug",
    title: `${severity} ${id}`,
    file: "src/a.ts",
    start_line: 10,
    end_line: 10,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev-new",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function review(id: string, findings: FindingRecord[], o: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id,
    pr_id: "pr-1",
    agent_id: "a1",
    run_id: `run-${id}`,
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: "s",
    score: 40,
    model: "gpt-4.1",
    grounding: "4/4 passed",
    created_at: "2026-10-11T10:00:00.000Z",
    findings,
    ...o,
  };
}

const NEWEST = review("rev-new", [
  f("s1", "SUGGESTION"),
  f("c1", "CRITICAL", { confidence: 0.7 }),
  f("w1", "WARNING", { start_line: 3, end_line: 5 }),
  f("c2", "CRITICAL", { confidence: 0.99, dismissed_at: "2026-10-11T10:05:00.000Z" }),
]);
const OLDER = review("rev-old", [f("x", "CRITICAL")], { agent_name: "Old Agent", created_at: "2026-10-10T10:00:00.000Z" });

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
    score: 40,
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

const titleLink = () => screen.getByRole("link", { name: "Add rate limiting" });
const indicator = () => screen.getByRole("button", { name: L.label });
const openFindingsLink = () => screen.getByRole("link", { name: L.open });
const dialog = () => screen.queryByRole("dialog");
const fetchedIds = () => usePrReviews.mock.calls.map(([id]) => id).filter((id) => id !== null);
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** The row container (the element that carries the hover handlers). */
const rowEl = () => titleLink().closest("div[style*='grid']") as HTMLElement;

/** Open instantly through the FINDINGS button (content tests). */
function openNow() {
  fireEvent.click(indicator());
}

beforeEach(() => {
  query = { data: [NEWEST, OLDER], isLoading: false, isError: false };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  push.mockClear();
  usePrReviews.mockClear();
});

describe("FindingsPopover — accessible semantics", () => {
  it("no interactive control is nested in another: the row is a plain container", () => {
    renderRow(pr());
    const row = rowEl();
    expect(row).not.toHaveAttribute("role");
    expect(row).not.toHaveAttribute("tabindex");
    // The title link and the FINDINGS button are siblings, not nested.
    expect(titleLink().querySelector("button")).toBeNull();
    expect(indicator().closest("a")).toBeNull();
    expect(screen.queryAllByRole("link").every((a) => a.querySelector("a, button") === null)).toBe(true);
  });

  it("the PR title is a real link to the PR (keyboard + new-tab friendly)", () => {
    renderRow(pr());
    expect(titleLink()).toHaveAttribute("href", "/repos/repo-1/pulls/482");
  });

  it("the FINDINGS button is a regular tab stop announcing a dialog", () => {
    renderRow(pr());
    expect(indicator()).not.toHaveAttribute("tabindex", "-1");
    expect(indicator()).toHaveAttribute("aria-haspopup", "dialog");
    expect(indicator()).toHaveAttribute("aria-expanded", "false");
    expect(indicator()).toHaveTextContent(L.short);
  });
});

describe("FindingsPopover — navigation", () => {
  it("clicking the title link navigates once (no double push from the row)", () => {
    renderRow(pr());
    fireEvent.click(titleLink());
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482");
  });

  it("a modified click (new tab) is left to the browser", () => {
    renderRow(pr());
    // Our handler leaves the default alone; stop jsdom's own navigation (not implemented).
    let defaultAllowed = false;
    titleLink().addEventListener("click", (e) => {
      defaultAllowed = !e.defaultPrevented;
      e.preventDefault();
    });
    fireEvent.click(titleLink(), { ctrlKey: true });
    expect(defaultAllowed).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it("clicking elsewhere on the row still navigates to the PR", () => {
    renderRow(pr());
    fireEvent.click(screen.getByText("marisa.koch"));
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482");
  });

  it("clicking the FINDINGS button or inside the popover does not navigate; its link opens findings", () => {
    renderRow(pr());
    fireEvent.click(indicator());
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(dialog()!);
    fireEvent.keyDown(dialog()!, { key: "Enter" });
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(openFindingsLink());
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482?tab=findings");
  });
});

describe("FindingsPopover — pointer preview", () => {
  it("hovering the row opens it after the delay, and only then fetches", () => {
    vi.useFakeTimers();
    renderRow(pr());
    fireEvent.mouseEnter(rowEl());
    wait(HOVER_OPEN_DELAY_MS - 50);
    expect(dialog()).not.toBeInTheDocument();
    expect(fetchedIds()).toEqual([]);
    wait(60);
    expect(dialog()).toBeInTheDocument();
    expect(fetchedIds().length).toBeGreaterThan(0);
    expect(fetchedIds().every((id) => id === "pr-1")).toBe(true);
    // A preview does not steal focus.
    expect(document.body).toHaveFocus();
  });

  it("sweeping the pointer across the row opens and fetches nothing", () => {
    vi.useFakeTimers();
    renderRow(pr());
    fireEvent.mouseEnter(rowEl());
    wait(100);
    fireEvent.mouseLeave(rowEl());
    wait(1000);
    expect(dialog()).not.toBeInTheDocument();
    expect(fetchedIds()).toEqual([]);
  });

  it("leaving the row closes it after a grace period; moving into the popover keeps it open", () => {
    vi.useFakeTimers();
    renderRow(pr());
    fireEvent.mouseEnter(rowEl());
    wait(HOVER_OPEN_DELAY_MS + 10);
    fireEvent.mouseLeave(rowEl());
    fireEvent.mouseEnter(dialog()!);
    wait(1000);
    expect(dialog()).toBeInTheDocument();
    fireEvent.mouseLeave(dialog()!);
    wait(1000);
    expect(dialog()).not.toBeInTheDocument();
  });

  it("Escape after a pointer preview closes it and leaves focus where it was", () => {
    vi.useFakeTimers();
    renderRow(pr());
    fireEvent.mouseEnter(rowEl());
    wait(HOVER_OPEN_DELAY_MS + 10);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(dialog()).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });
});

describe("FindingsPopover — keyboard", () => {
  it("focusing the title link previews it after the delay and describes the link", () => {
    vi.useFakeTimers();
    renderRow(pr());
    act(() => titleLink().focus());
    expect(dialog()).not.toBeInTheDocument();
    wait(HOVER_OPEN_DELAY_MS + 10);
    expect(dialog()).toBeInTheDocument();
    expect(titleLink()).toHaveAttribute("aria-describedby", dialog()!.id);
    expect(titleLink()).toHaveFocus();
  });

  it("tabbing past the row quickly fetches nothing", () => {
    vi.useFakeTimers();
    renderRow(pr());
    act(() => titleLink().focus());
    wait(100);
    act(() => indicator().focus());
    wait(100);
    act(() => indicator().blur());
    wait(1000);
    expect(dialog()).not.toBeInTheDocument();
    expect(fetchedIds()).toEqual([]);
  });

  it("Escape during a title-link preview closes it, keeps focus on the link, and does not reopen", () => {
    vi.useFakeTimers();
    renderRow(pr());
    act(() => titleLink().focus());
    wait(HOVER_OPEN_DELAY_MS + 10);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(dialog()).not.toBeInTheDocument();
    expect(titleLink()).toHaveFocus();
    wait(2000);
    expect(dialog()).not.toBeInTheDocument();
  });

  it("activating the FINDINGS button opens at once and moves focus to the popover's link", () => {
    renderRow(pr());
    act(() => indicator().focus());
    fireEvent.click(indicator()); // Enter / Space on a button fire click
    expect(dialog()).toBeInTheDocument();
    expect(indicator()).toHaveAttribute("aria-expanded", "true");
    expect(indicator()).toHaveAttribute("aria-controls", dialog()!.id);
    expect(openFindingsLink()).toHaveFocus();
  });

  it("while loading (no link yet) focus goes to the dialog itself", () => {
    query = { data: undefined, isLoading: true, isError: false };
    renderRow(pr());
    fireEvent.click(indicator());
    expect(dialog()).toHaveFocus();
  });

  it("Tab past the last control closes it and returns to the FINDINGS button", () => {
    vi.useFakeTimers();
    renderRow(pr());
    fireEvent.click(indicator());
    expect(openFindingsLink()).toHaveFocus();
    fireEvent.keyDown(openFindingsLink(), { key: "Tab" });
    expect(dialog()).not.toBeInTheDocument();
    expect(indicator()).toHaveFocus();
    wait(2000); // focus returned without reopening
    expect(dialog()).not.toBeInTheDocument();
  });

  it("Shift+Tab before the first control closes it and returns to the FINDINGS button", () => {
    renderRow(pr());
    fireEvent.click(indicator());
    fireEvent.keyDown(openFindingsLink(), { key: "Tab", shiftKey: true });
    expect(dialog()).not.toBeInTheDocument();
    expect(indicator()).toHaveFocus();
  });

  it("Escape inside the popover closes it, restores focus to the button, and does not reopen", () => {
    vi.useFakeTimers();
    renderRow(pr());
    fireEvent.click(indicator());
    expect(openFindingsLink()).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(dialog()).not.toBeInTheDocument();
    expect(indicator()).toHaveFocus();
    wait(2000);
    expect(dialog()).not.toBeInTheDocument();
  });

  it("Enter on the popover's link opens the findings tab", () => {
    renderRow(pr());
    fireEvent.click(indicator());
    // Enter on a focused link fires its click.
    fireEvent.click(openFindingsLink());
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482?tab=findings");
  });
});

describe("FindingsPopover — content", () => {
  it("H1: shows the LATEST review's counts, open criticals, verdict and top 3 findings", () => {
    renderRow(pr());
    openNow();
    const d = dialog()!;
    expect(d).toHaveTextContent("Security Reviewer");
    expect(d).not.toHaveTextContent("Old Agent");
    expect(d).toHaveTextContent("Request changes");
    const count = (k: string) => d.querySelector(`[data-severity="${k}"]`)!.textContent;
    expect(count("CRITICAL")).toContain("2");
    expect(count("WARNING")).toContain("1");
    expect(count("SUGGESTION")).toContain("1");
    expect(d).toHaveTextContent("4 findings in the latest review");
    // c2 is dismissed → not open.
    expect(d).toHaveTextContent("1 open critical");
    // Undismissed first, then severity, then confidence; 3 shown, 1 more.
    const items = Array.from(d.querySelectorAll("li")).map((li) => li.textContent);
    expect(items[0]).toContain("CRITICAL c1");
    expect(items[1]).toContain("WARNING w1");
    expect(items[1]).toContain("src/a.ts:3-5");
    expect(items[2]).toContain("SUGGESTION s1");
    expect(d).toHaveTextContent("+1 more");
    expect(screen.getByRole("link", { name: L.open })).toHaveAttribute(
      "href",
      "/repos/repo-1/pulls/482?tab=findings",
    );
  });

  it("H2: an unreviewed PR shows 'Not reviewed yet' without any request", () => {
    renderRow(pr({ score: null }));
    openNow();
    expect(dialog()).toHaveTextContent(L.notReviewed);
    expect(fetchedIds()).toEqual([]);
  });

  it("shows a loading state, never a misleading zero", () => {
    query = { data: undefined, isLoading: true, isError: false };
    renderRow(pr());
    openNow();
    expect(dialog()).toHaveTextContent(L.loading);
    expect(dialog()!.querySelector("[data-severity]")).toBeNull();
  });

  it("shows an error when the request failed", () => {
    query = { data: undefined, isLoading: false, isError: true };
    renderRow(pr());
    openNow();
    expect(dialog()).toHaveTextContent(L.error);
    expect(dialog()!.querySelector("[data-severity]")).toBeNull();
  });

  it("a latest review with zero findings says so, with zero counts", () => {
    query = { data: [review("empty", [], { verdict: "approve" })], isLoading: false, isError: false };
    renderRow(pr());
    openNow();
    expect(dialog()).toHaveTextContent(L.empty);
    expect(dialog()!.querySelector('[data-severity="CRITICAL"]')!.textContent).toContain("0");
  });

  it("no review rows (e.g. only a summary) → 'No review found'", () => {
    query = { data: [review("sum", [], { kind: "summary" })], isLoading: false, isError: false };
    renderRow(pr());
    openNow();
    expect(dialog()).toHaveTextContent(L.noReview);
  });
});

describe("latestReview", () => {
  it("picks the newest 'review' (API is newest-first) and skips summaries", () => {
    expect(latestReview(undefined)).toBeUndefined();
    expect(latestReview([review("s", [], { kind: "summary" }), NEWEST, OLDER])?.id).toBe("rev-new");
  });
});
