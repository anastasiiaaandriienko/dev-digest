/**
 * L07 B13 — CI Runs page (/ci-runs; specs/export-to-ci.md §6.3; AC-CI-49, 51..54, 57, 76,
 * 82): every verdict, the columns, `?agent_id=&repo=` filters (also the CI tab's History
 * link), loading / empty / no-match / error + Retry, manual and automatic sync, safe links.
 * Hooks, routing and the app shell are mocked; no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiRun, CiSyncResult } from "@devdigest/shared";
import ciMessages from "../../../../../messages/en/ci.json";

const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => params, useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

type RunsQ = { data?: CiRun[]; isLoading: boolean; isError: boolean; error?: Error; refetch: () => Promise<unknown> };
let runsQ: RunsQ;
const runsArgs: unknown[] = [];
const autoSync = vi.fn();
const syncMutate = vi.fn();
let syncPending = false;
let syncResult: CiSyncResult;
vi.mock("@/lib/hooks/ci", () => ({
  useCiRuns: (filters: unknown) => {
    runsArgs.push(filters);
    return runsQ;
  },
  useCiAutoSync: () => autoSync(),
  useCiSync: () => ({
    isPending: syncPending,
    mutate: (vars: unknown, opts?: { onSuccess?: (r: CiSyncResult) => void }) => {
      syncMutate(vars);
      opts?.onSuccess?.(syncResult);
    },
  }),
}));
const AGENT_ID = "11111111-1111-4111-8111-111111111111";
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [{ id: AGENT_ID, name: "Security Reviewer" } as Agent], isLoading: false, isError: false }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repos: [{ full_name: "acme/widgets" }, { full_name: "acme/api" }] }),
}));

import { notify } from "@/lib/toast";
import CiRunsPage from "../../page";
import { CiRunsView } from "./CiRunsView";
import { filtersHref, fmtDuration, readFilters, safeJobUrl, shortSha } from "./helpers";

function run(over: Partial<CiRun>): CiRun {
  return {
    id: "r1",
    ci_installation_id: "i1",
    pr_number: 7,
    ran_at: "2026-10-24T10:00:00.000Z",
    status: "succeeded",
    findings_count: 2,
    cost_usd: 0.01,
    github_url: "https://github.com/acme/widgets/actions/runs/101",
    source: "ci",
    agent: "Security Reviewer",
    duration_s: 4.2,
    repo: "acme/widgets",
    commit_sha: "a1b2c3d4e5f60718",
    verdict: "passed",
    agent_run_id: "ar1",
    ...over,
  };
}
const q = (o: Partial<RunsQ>): RunsQ => ({ data: [], isLoading: false, isError: false, refetch: vi.fn(async () => undefined), ...o });

function renderPage(ui: React.ReactElement = <CiRunsView />) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }} now={new Date("2026-10-24T12:00:00Z")}>
      {ui}
    </NextIntlClientProvider>,
  );
}

let toasts: { kind: string; msg: string }[];
beforeEach(() => {
  params = new URLSearchParams();
  replace.mockReset();
  runsQ = q({});
  runsArgs.length = 0;
  autoSync.mockReset();
  syncMutate.mockReset();
  syncPending = false;
  syncResult = { ingested: 0, throttled: 0, skipped: [], errors: [] };
  toasts = [];
  for (const kind of ["success", "error", "info"] as const) {
    vi.spyOn(notify, kind).mockImplementation((msg: string, _opts?: unknown) => void toasts.push({ kind, msg }));
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CI Runs — table (AC-CI-51, 54, 76)", () => {
  it("lists runs with every verdict and the columns in spec order", () => {
    runsQ = q({
      data: [
        run({ id: "a", verdict: "blocked", findings_count: 3, duration_s: 65 }),
        run({ id: "b", verdict: "passed", findings_count: 0 }),
        run({ id: "c", verdict: "failed", findings_count: null, cost_usd: null, duration_s: null, status: "failed" }),
      ],
    });
    renderPage();
    const table = screen.getByRole("table", { name: "CI runs" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Repository", "PR", "Agent", "Verdict", "Findings", "Cost", "Duration", "Commit", "Ran", "Job",
    ]);
    const rows = screen.getAllByTestId("ci-run-row");
    expect(rows.map((r) => r.getAttribute("data-verdict"))).toEqual(["blocked", "passed", "failed"]);
    expect(within(rows[0]!).getByText("Blocked")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Passed")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Failed")).toBeInTheDocument();

    const cells = within(rows[0]!).getAllByRole("cell").map((c) => c.textContent);
    expect(cells.slice(0, 9)).toEqual(["acme/widgets", "#7", "Security Reviewer", "Blocked", "3", "$0.01", "1m 05s", "a1b2c3d", "2 hours ago"]);
    expect(within(rows[0]!).getByTitle("a1b2c3d4e5f60718")).toBeInTheDocument();
    // unknown cost / findings / duration → "—" (AC-CI-54)
    const failedCells = within(rows[2]!).getAllByRole("cell").map((c) => c.textContent);
    expect([failedCells[4], failedCells[5], failedCells[6]]).toEqual(["—", "—", "—"]);
  });

  it("links the Actions job only from the API's GitHub https URL; PR is text, no built URL", () => {
    runsQ = q({
      data: [
        run({ id: "ok" }),
        run({ id: "evil", github_url: "javascript:alert(1)" }),
        run({ id: "http", github_url: "http://github.com/acme/widgets/actions/runs/1" }),
        run({ id: "none", github_url: null }),
      ],
    });
    const { container } = renderPage();
    const links = screen.getAllByRole("link", { name: /View the GitHub Actions job/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://github.com/acme/widgets/actions/runs/101");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(container.querySelector('a[href*="/pull/"]')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("renders repo, agent and SHA strings as text only", () => {
    runsQ = q({ data: [run({ repo: 'acme/<img src=x onerror="alert(1)">', agent: "<b>bold</b>" })] });
    const { container } = renderPage();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
  });
});

describe("CI Runs — filters in the URL (AC-CI-82)", () => {
  it("no query → all runs of the workspace; the API gets no filter (and no workspace id: the server scopes it)", () => {
    renderPage();
    expect(runsArgs.at(-1)).toEqual({});
    expect(screen.getByRole("combobox", { name: "Agent" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Repository" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("the CI tab's History link (?agent_id=&repo=) selects both filters", () => {
    params = new URLSearchParams(`agent_id=${AGENT_ID}&repo=acme%2Fwidgets`);
    renderPage();
    expect(runsArgs.at(-1)).toEqual({ agentId: AGENT_ID, repo: "acme/widgets" });
    expect(screen.getByRole("combobox", { name: "Agent" })).toHaveValue(AGENT_ID);
    expect(screen.getByRole("combobox", { name: "Repository" })).toHaveValue("acme/widgets");
  });

  it("malformed query values are ignored, never sent", () => {
    params = new URLSearchParams("agent_id=not-a-uuid&repo=../../etc");
    renderPage();
    expect(runsArgs.at(-1)).toEqual({});
  });

  it("changing a selector rewrites the URL (replace); empty removes that filter; Clear removes both", () => {
    params = new URLSearchParams("repo=acme%2Fwidgets");
    runsQ = q({ data: [run({})] });
    renderPage();
    fireEvent.change(screen.getByRole("combobox", { name: "Agent" }), { target: { value: AGENT_ID } });
    expect(replace).toHaveBeenLastCalledWith(`/ci-runs?agent_id=${AGENT_ID}&repo=acme%2Fwidgets`);
    fireEvent.change(screen.getByRole("combobox", { name: "Repository" }), { target: { value: "" } });
    expect(replace).toHaveBeenLastCalledWith("/ci-runs");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(replace).toHaveBeenLastCalledWith("/ci-runs");
  });

  it("a URL agent / repo not in the workspace lists is still shown as the selected value", () => {
    params = new URLSearchParams("agent_id=22222222-2222-4222-8222-222222222222&repo=acme%2Fgone");
    renderPage();
    expect(screen.getByRole("combobox", { name: "Agent" })).toHaveValue("22222222-2222-4222-8222-222222222222");
    expect(screen.getByRole("combobox", { name: "Repository" })).toHaveValue("acme/gone");
  });
});

describe("CI Runs — states (AC-CI-52, 53)", () => {
  it("loading: no table, no empty state", () => {
    runsQ = q({ data: undefined, isLoading: true });
    renderPage();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("No CI runs yet")).toBeNull();
  });

  it("error: the message and Retry refetches", () => {
    runsQ = q({ data: undefined, isError: true, error: new Error("Cannot reach the DevDigest engine") });
    renderPage();
    expect(screen.getByText("Could not load CI runs")).toBeInTheDocument();
    expect(screen.getByText("Cannot reach the DevDigest engine")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(runsQ.refetch).toHaveBeenCalled();
  });

  it("no runs at all: empty state with a link to Agents", () => {
    renderPage();
    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Agents" })).toHaveAttribute("href", "/agents");
  });

  it("no runs for the filters: 'no match' with Clear filters", () => {
    params = new URLSearchParams("repo=acme%2Fapi");
    renderPage();
    expect(screen.getByText("No CI runs match these filters")).toBeInTheDocument();
    expect(screen.queryByText("No CI runs yet")).toBeNull();
    const clear = screen.getAllByRole("button", { name: "Clear filters" });
    fireEvent.click(clear.at(-1)!);
    expect(replace).toHaveBeenLastCalledWith("/ci-runs");
  });

  it("no header statistics or pagination", () => {
    runsQ = q({ data: [run({})] });
    renderPage();
    expect(screen.queryByRole("navigation", { name: /pagination/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /next|previous|load more/i })).toBeNull();
  });
});

describe("CI Runs — sync (AC-CI-49, 57)", () => {
  it("opening the page starts the automatic sync", () => {
    renderPage();
    expect(autoSync).toHaveBeenCalled();
  });

  const CASES: [CiSyncResult, string, string][] = [
    [{ ingested: 3, throttled: 0, skipped: [], errors: [] }, "success", "Sync finished: 3 new runs"],
    [{ ingested: 0, throttled: 2, skipped: [], errors: [] }, "info", "Synced less than a minute ago — try again shortly."],
    [{ ingested: 0, throttled: 0, skipped: [], errors: [{ installation_id: "i1", repo: "acme/widgets", message: "GitHub HTTP 401: Bad credentials" }] }, "error", "GitHub HTTP 401: Bad credentials"],
  ];
  it.each(CASES)("Sync runs a manual sync of all installations and reports it", (result, kind, msg) => {
    syncResult = result;
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(syncMutate).toHaveBeenCalledWith({ mode: "manual" });
    expect(toasts).toEqual([{ kind, msg }]);
  });

  it("while syncing the button is disabled and says so", () => {
    syncPending = true;
    renderPage();
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();
  });
});

describe("CI Runs — route and helpers", () => {
  it("the /ci-runs route renders the page", () => {
    renderPage(<CiRunsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "CI Runs" })).toBeInTheDocument();
  });

  it("readFilters / filtersHref / safeJobUrl / shortSha / fmtDuration", () => {
    expect(readFilters(new URLSearchParams(`agent_id=${AGENT_ID}&repo=a/b`))).toEqual({ agentId: AGENT_ID, repo: "a/b" });
    expect(readFilters(new URLSearchParams("agent_id=x&repo=a"))).toEqual({});
    expect(filtersHref({})).toBe("/ci-runs");
    expect(filtersHref({ agentId: "x", repo: "a/b" })).toBe("/ci-runs?agent_id=x&repo=a%2Fb");
    expect(safeJobUrl("https://github.com/a/b/actions/runs/1")).toBe("https://github.com/a/b/actions/runs/1");
    expect(safeJobUrl("https://evil.com/github.com/")).toBeNull();
    expect(safeJobUrl(null)).toBeNull();
    expect(shortSha("abcdef1234")).toBe("abcdef1");
    expect(shortSha(null)).toBeNull();
    expect(fmtDuration(4.24)).toBe("4.2 s");
    expect(fmtDuration(125)).toBe("2m 05s");
    expect(fmtDuration(null)).toBeNull();
    expect(fmtDuration(-1)).toBeNull();
  });
});
