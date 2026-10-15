/**
 * /repos/:repoId/conventions (HW2 #44–#52): empty / loading / error states,
 * Run Scan vs ReScan, scan progress and failure, the candidate list with the
 * accepted count, and "Create skill" only once something is accepted. Hooks,
 * AppShell and the repo context are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate, ConventionScan, ConventionsState } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import skillsMessages from "../../../../../../../messages/en/skills.json";

type Q = { data?: ConventionsState; isLoading: boolean; isError: boolean; refetch: () => void };
let query: Q;
const startScan = vi.fn();
const updateAsync = vi.fn();
let starting = false;
let notFound = false;
vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => query,
  useStartConventionScan: () => ({ mutate: startScan, isPending: starting }),
  useUpdateConvention: () => ({ mutateAsync: updateAsync }),
  useConventionSkillDraft: () => ({ data: undefined, isLoading: true, isError: false }),
  useCreateConventionSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: [] }) }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repos: [{ id: "r1", full_name: "acme/payments-api" }] }),
  useRepoNotFound: () => notFound,
}));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ConventionsView } from "./ConventionsView";

const P = messages.page;
const cand = (id: string, status: ConventionCandidate["status"] = "pending"): ConventionCandidate => ({
  id,
  repo_id: "r1",
  rule: `Rule ${id}`,
  category: "naming",
  evidence_path: "src/a.ts",
  evidence_line: 3,
  evidence_snippet: "const a = 1;",
  confidence: 0.9,
  status,
  accepted: status === "accepted",
  scan_id: "s",
  created_at: "2026-10-15T10:00:00.000Z",
  updated_at: "2026-10-15T10:00:00.000Z",
});
const scan = (o: Partial<ConventionScan> = {}): ConventionScan => ({
  id: "s",
  repo_id: "r1",
  status: "done",
  provider: "openrouter",
  model: "deepseek/deepseek-v4",
  sample_files: ["tsconfig.json", "src/a.ts", "src/b.ts"],
  candidates_found: 4,
  candidates_added: 2,
  tokens_in: 1000,
  tokens_out: 200,
  cost_usd: 0.001,
  error: null,
  started_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
  finished_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
  ...o,
});
const state = (o: Partial<ConventionsState> = {}): Q => ({
  data: { scan: null, candidates: [], counts: { pending: 0, accepted: 0, rejected: 0 }, ...o },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});

beforeEach(() => {
  query = state();
  starting = false;
  notFound = false;
});
afterEach(() => {
  cleanup();
  startScan.mockReset();
  updateAsync.mockReset();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages, skills: skillsMessages }}>
      <ConventionsView repoId="r1" />
    </NextIntlClientProvider>,
  );
}
// The header action (an empty repo also offers it as the empty-state CTA).
const runBtn = () => screen.getAllByRole("button", { name: P.runScan })[0]!;
const rescanBtn = () => screen.getByRole("button", { name: P.rescan });

describe("ConventionsView — header and scans (HW2 #45)", () => {
  it("shows the repo and two separate actions: Run Scan first, ReScan disabled", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Conventions in acme/payments-api");
    expect(runBtn()).toBeEnabled();
    expect(rescanBtn()).toBeDisabled();
    fireEvent.click(runBtn());
    expect(startScan).toHaveBeenCalledWith(false);
  });

  it("empty repo: the empty state's CTA also runs the first scan", () => {
    renderView();
    expect(screen.getByText(P.empty.title)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: P.empty.cta });
    expect(buttons).toHaveLength(2); // header + empty-state CTA
    fireEvent.click(buttons[1]!);
    expect(startScan).toHaveBeenLastCalledWith(false);
  });

  it("after a successful scan: last scan summary, Run Scan disabled, ReScan runs again", () => {
    query = state({ scan: scan(), candidates: [cand("a")], counts: { pending: 1, accepted: 0, rejected: 0 } });
    renderView();
    expect(screen.getByTestId("scan-summary")).toHaveTextContent(
      "Last scan 3 hours ago · 3 sample files · deepseek/deepseek-v4 · 2 new candidates",
    );
    expect(runBtn()).toBeDisabled();
    fireEvent.click(rescanBtn());
    expect(startScan).toHaveBeenCalledWith(true);
  });

  it("while a scan runs: progress banner, both actions disabled", () => {
    query = state({ scan: scan({ status: "running", finished_at: null, model: "gpt-5.4" }) });
    renderView();
    expect(screen.getByRole("status")).toHaveTextContent(P.scanning);
    expect(screen.getByRole("status")).toHaveTextContent("asking gpt-5.4");
    expect(runBtn()).toBeDisabled();
    expect(rescanBtn()).toBeDisabled();
    expect(screen.queryByText(P.empty.title)).toBeNull();
  });

  it("a failed scan shows why and that decisions were kept; both actions available", () => {
    query = state({ scan: scan({ status: "failed", error: "OPENROUTER_API_KEY is not configured" }), candidates: [cand("a", "accepted")], counts: { pending: 0, accepted: 1, rejected: 0 } });
    renderView();
    const alert = screen.getByTestId("scan-failed");
    expect(alert).toHaveTextContent(P.extractionFailed);
    expect(alert).toHaveTextContent("OPENROUTER_API_KEY is not configured");
    expect(alert).toHaveTextContent(P.extractionFailedHint);
    expect(runBtn()).toBeEnabled();
    expect(rescanBtn()).toBeEnabled();
    expect(screen.getByText("Rule a")).toBeInTheDocument();
  });

  it("loading and error states", () => {
    query = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    const r = renderView();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    r.unmount();
    const refetch = vi.fn();
    query = { data: undefined, isLoading: false, isError: true, refetch };
    renderView();
    expect(screen.getByText(P.loadError)).toBeInTheDocument();
  });

  it("an unknown repo shows the repo-not-found state", () => {
    notFound = true;
    renderView();
    expect(screen.getByText("repo not found")).toBeInTheDocument();
  });
});

describe("ConventionsView — candidates (HW2 #46–#48, #50)", () => {
  it("lists the candidates with the accepted count; rejected ones are only counted", () => {
    query = state({
      scan: scan(),
      candidates: [cand("a", "accepted"), cand("b"), cand("c")],
      counts: { pending: 2, accepted: 1, rejected: 4 },
    });
    renderView();
    const list = screen.getByRole("list", { name: P.candidatesLabel });
    expect(within(list).getAllByRole("listitem").map((li) => li.getAttribute("data-convention-id"))).toEqual(["a", "b", "c"]);
    expect(screen.getByTestId("accepted-count")).toHaveTextContent("1 of 3 accepted");
    expect(screen.getByText("· 4 rejected rules hidden")).toBeInTheDocument();
  });

  it("Create skill appears only once something is accepted and opens the modal", () => {
    query = state({ scan: scan(), candidates: [cand("a")], counts: { pending: 1, accepted: 0, rejected: 0 } });
    const r = renderView();
    expect(screen.queryByRole("button", { name: P.createSkill })).toBeNull();
    r.unmount();
    query = state({ scan: scan(), candidates: [cand("a", "accepted")], counts: { pending: 0, accepted: 1, rejected: 0 } });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: P.createSkill }));
    expect(screen.getByRole("dialog")).toHaveTextContent(messages.createSkill.title);
  });

  it("a decision on a card goes to the update mutation with that card's id", () => {
    updateAsync.mockResolvedValue(undefined);
    query = state({ scan: scan(), candidates: [cand("a"), cand("b")], counts: { pending: 2, accepted: 0, rejected: 0 } });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Reject: Rule b" }));
    expect(updateAsync).toHaveBeenCalledWith({ id: "b", patch: { status: "rejected" } });
  });

  it("everything decided → 'nothing left to review'", () => {
    query = state({ scan: scan(), candidates: [], counts: { pending: 0, accepted: 0, rejected: 3 } });
    renderView();
    expect(screen.getByText(P.noPending.title)).toBeInTheDocument();
  });
});
