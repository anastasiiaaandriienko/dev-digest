/**
 * L07 B10 — Agent CI tab (specs/export-to-ci.md §6.3, AC-CI-49, 57, 60..67, 76): states
 * (loading / error / empty / pending / active / error installation), row links and actions,
 * the wizard entry point (disabled until B11 plugs the wizard in) and "Fail CI on".
 * Data hooks are mocked; no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiInstallationView, CiSyncResult } from "@devdigest/shared";
import ciMessages from "../../../../../../../../messages/en/ci.json";
import agentMessages from "../../../../../../../../messages/en/agents.json";

type QueryState = { data?: CiInstallationView[]; isLoading?: boolean; isError?: boolean; error?: Error };
let installations: QueryState = {};
const refetch = vi.fn();
const autoSync = vi.fn();
const syncMutate = vi.fn();
const updateMutate = vi.fn();
let syncResult: CiSyncResult = { ingested: 0, throttled: 0, skipped: [], errors: [] };

vi.mock("@/lib/hooks/ci", () => ({
  useCiInstallations: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch, ...installations }),
  useCiAutoSync: () => autoSync(),
  useCiSync: () => ({
    mutate: (vars: unknown, opts?: { onSuccess?: (r: CiSyncResult) => void; onSettled?: () => void }) => {
      syncMutate(vars);
      opts?.onSuccess?.(syncResult);
      opts?.onSettled?.();
    },
  }),
  // The real export wizard (opened by default) only needs these to render its first step.
  useRepoCiInstallations: () => ({ data: [], isSuccess: true, isLoading: false, isError: false }),
  useCiPreview: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useExportCi: () => ({ mutate: vi.fn(), isPending: false }),
  useExportCiZip: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/active" }, repos: [{ full_name: "acme/active" }, { full_name: "acme/widgets" }] }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({
    mutate: (vars: unknown, opts?: { onSuccess?: () => void }) => {
      updateMutate(vars);
      opts?.onSuccess?.();
    },
  }),
}));

import { notify } from "@/lib/toast";
import { CiTab } from "./CiTab";
import type { RenderCiWizard } from "./helpers";
import { activeCount, ciRunsHref, isOutdated } from "./helpers";

const AGENT: Agent = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "x",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

function inst(over: Partial<CiInstallationView> = {}): CiInstallationView {
  return {
    id: "i1",
    agent_id: AGENT.id,
    repo: "acme/widgets",
    target_type: "gha",
    installed_at: "2026-10-20T10:00:00.000Z",
    status: "pending",
    agent_version: 3,
    pr_url: "https://github.com/acme/widgets/pull/12",
    updated_at: "2026-10-20T10:00:00.000Z",
    last_synced_at: null,
    agent_name: AGENT.name,
    last_run_status: null,
    last_run_at: null,
    ...over,
  };
}

/** `renderWizard: null` = no wizard (buttons disabled); omitted = a stub, so tests never render the real one. */
function renderTab(props: { renderWizard?: RenderCiWizard | null; dirty?: boolean; agent?: Agent; realWizard?: boolean } = {}) {
  const guardRef = { current: { dirty: props.dirty ?? false, save: async () => true } };
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages, agents: agentMessages }} now={new Date("2026-10-24T12:00:00Z")}>
      <CiTab agent={props.agent ?? AGENT} guardRef={guardRef} {...(props.realWizard ? {} : { renderWizard: "renderWizard" in props ? props.renderWizard : () => null })} />
    </NextIntlClientProvider>,
  );
}

let toasts: { kind: string; msg: string }[];
beforeEach(() => {
  installations = {};
  syncResult = { ingested: 0, throttled: 0, skipped: [], errors: [] };
  refetch.mockReset();
  autoSync.mockReset();
  syncMutate.mockReset();
  updateMutate.mockReset();
  toasts = [];
  for (const kind of ["success", "error", "info"] as const) {
    vi.spyOn(notify, kind).mockImplementation((msg: string) => void toasts.push({ kind, msg }));
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CiTab — states", () => {
  it("starts the automatic sync on open and shows the heading", () => {
    installations = { data: [] };
    renderTab();
    expect(autoSync).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 2, name: "CI deployment" })).toBeInTheDocument();
  });

  it("loading: no rows, no empty or error state", () => {
    installations = { isLoading: true };
    renderTab();
    expect(screen.queryAllByTestId("ci-installation")).toEqual([]);
    expect(screen.queryByText("Not deployed to CI yet")).toBeNull();
    expect(screen.queryByText("Could not load CI installations")).toBeNull();
  });

  it("API error: message + Retry refetches", () => {
    installations = { isError: true, error: new Error("Cannot reach the DevDigest engine") };
    renderTab();
    expect(screen.getByText("Could not load CI installations")).toBeInTheDocument();
    expect(screen.getByText("Cannot reach the DevDigest engine")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("not exported yet: empty state; its CTA opens the wizard once one is plugged in", () => {
    installations = { data: [] };
    renderTab({ renderWizard: null });
    expect(screen.getByText("Not deployed to CI yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Add to CI/ })).toHaveLength(1); // header only, CTA hidden
    cleanup();

    const renderWizard = vi.fn(() => <div data-testid="wizard" />);
    renderTab({ renderWizard });
    const buttons = screen.getAllByRole("button", { name: /Add to CI/ });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    expect(renderWizard).toHaveBeenLastCalledWith({ mode: "add" }, expect.any(Function));
    expect(screen.getByTestId("wizard")).toBeInTheDocument();
  });

  it("pending: status, export PR link (new tab, noopener), pending hint, no runs yet, workflow version", () => {
    installations = { data: [inst()] };
    renderTab();
    const row = screen.getByTestId("ci-installation");
    expect(row).toHaveAttribute("data-status", "pending");
    expect(within(row).getByText("acme/widgets")).toBeInTheDocument();
    expect(within(row).getByText("GitHub Actions")).toBeInTheDocument();
    expect(within(row).getByText("Pending")).toBeInTheDocument();
    const pr = within(row).getByRole("link", { name: "Open PR" });
    expect(pr).toHaveAttribute("href", "https://github.com/acme/widgets/pull/12");
    expect(pr).toHaveAttribute("target", "_blank");
    expect(pr).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(row).getByText("Waiting for the export PR to be merged.")).toBeInTheDocument();
    expect(within(row).getByText("No runs yet")).toBeInTheDocument();
    expect(within(row).getByText("workflow version v3")).toBeInTheDocument();
    expect(screen.queryByText(/Active in/)).toBeNull();
  });

  it("active: 'Active in N repos', last run status + relative time, outdated mark, no PR link", () => {
    installations = {
      data: [
        inst({ status: "active", agent_version: 2, last_run_status: "succeeded", last_run_at: "2026-10-24T10:00:00.000Z" }),
        inst({ id: "i2", repo: "acme/api", status: "active", last_run_status: "no_findings", last_run_at: "2026-10-24T11:30:00.000Z" }),
      ],
    };
    renderTab();
    expect(screen.getByText("Active in 2 repos")).toBeInTheDocument();
    const [first, second] = screen.getAllByTestId("ci-installation");
    expect(within(first!).getByText("Last run: findings · 2 hours ago")).toBeInTheDocument();
    expect(within(first!).getByText(/workflow version v2 · outdated — the agent is v3/)).toBeInTheDocument();
    expect(within(first!).queryByRole("link", { name: "Open PR" })).toBeNull();
    expect(within(second!).getByText("Last run: no findings · 30 minutes ago")).toBeInTheDocument();
    expect(within(second!).queryByText(/outdated/)).toBeNull();
  });

  it("error: status and the access hint; not counted as active", () => {
    installations = { data: [inst({ status: "error" })] };
    renderTab();
    const row = screen.getByTestId("ci-installation");
    expect(within(row).getByText("Error")).toBeInTheDocument();
    expect(within(row).getByText(/cannot reach this repository on GitHub/)).toBeInTheDocument();
    expect(screen.queryByText(/Active in/)).toBeNull();
  });

  it("renders repo names and statuses as text only (AC-CI-76)", () => {
    installations = { data: [inst({ repo: 'acme/<img src=x onerror="alert(1)">', last_run_status: "<b>x</b>", last_run_at: "2026-10-24T11:00:00.000Z" })] };
    const { container } = renderTab();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText('acme/<img src=x onerror="alert(1)">')).toBeInTheDocument();
  });
});

describe("CiTab — actions", () => {
  it("History links to CI Runs filtered by agent and repo (AC-CI-67)", () => {
    installations = { data: [inst()] };
    renderTab();
    expect(screen.getByRole("link", { name: "CI run history of acme/widgets" })).toHaveAttribute(
      "href",
      `/ci-runs?agent_id=${AGENT.id}&repo=acme%2Fwidgets`,
    );
  });

  const SYNC_CASES: [CiSyncResult, string, string][] = [
    [{ ingested: 2, throttled: 0, skipped: [], errors: [] }, "success", "Sync finished: 2 new runs"],
    [{ ingested: 0, throttled: 1, skipped: [], errors: [] }, "info", "Synced less than a minute ago — try again shortly."],
    [
      { ingested: 0, throttled: 0, skipped: [], errors: [{ installation_id: "i1", repo: "acme/widgets", message: "GitHub HTTP 401: Bad credentials" }] },
      "error",
      "GitHub HTTP 401: Bad credentials",
    ],
  ];
  it.each(SYNC_CASES)("Sync syncs that installation manually and reports the result (AC-CI-57)", (result, kind, msg) => {
    syncResult = result;
    installations = { data: [inst()] };
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Sync CI runs of acme/widgets" }));
    expect(syncMutate).toHaveBeenCalledWith({ mode: "manual", installation_id: "i1" });
    expect(toasts).toEqual([{ kind, msg }]);
  });

  it("without a wizard, Update / Add buttons are disabled with a note", () => {
    installations = { data: [inst()] };
    renderTab({ renderWizard: null });
    for (const name of ["Update CI config", "Add to CI", "Add repository"]) {
      const button = screen.getByRole("button", { name: new RegExp(name) });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "The export wizard is not available yet.");
    }
  });

  it("with a wizard, Update CI config opens it for that installation; Add repository for a new repo; close discards it", () => {
    installations = { data: [inst({ repo: "acme/api" })] };
    let close: () => void = () => undefined;
    const renderWizard = vi.fn<RenderCiWizard>((_req, c) => {
      close = c;
      return <div data-testid="wizard" />;
    });
    renderTab({ renderWizard });
    fireEvent.click(screen.getByRole("button", { name: "Update CI config" }));
    expect(renderWizard).toHaveBeenLastCalledWith({ mode: "update", repo: "acme/api", target: "gha" }, expect.any(Function));
    fireEvent.click(screen.getByRole("button", { name: /Add repository/ }));
    expect(renderWizard).toHaveBeenLastCalledWith({ mode: "add" }, expect.any(Function));
    expect(screen.getByTestId("wizard")).toBeInTheDocument();
    act(() => close()); // the wizard's own × / Esc
    expect(screen.queryByTestId("wizard")).toBeNull();
  });

  it("Fail CI on saves ci_fail_on through the agent update and says CI needs Update CI config (AC-CI-65)", () => {
    installations = { data: [] };
    renderTab();
    const select = screen.getByRole("combobox", { name: "Fail CI on" });
    expect(select).toHaveValue("critical");
    fireEvent.change(select, { target: { value: "warning" } });
    expect(updateMutate).toHaveBeenCalledWith({ id: AGENT.id, patch: { ci_fail_on: "warning" } });
    expect(toasts).toEqual([{ kind: "success", msg: "Fail CI on saved. Use “Update CI config” to apply it in CI." }]);
    expect(screen.getByText("The repository’s copy changes only after “Update CI config”.")).toBeInTheDocument();
  });

  it("Fail CI on is not saved while the Config tab has unsaved edits (a save would reset them)", () => {
    installations = { data: [] };
    renderTab({ dirty: true });
    fireEvent.change(screen.getByRole("combobox", { name: "Fail CI on" }), { target: { value: "any" } });
    expect(updateMutate).not.toHaveBeenCalled();
    expect(toasts).toEqual([{ kind: "info", msg: "Save or discard the Config tab changes first." }]);
  });
});

describe("CiTab — the real export wizard (default)", () => {
  it("Add to CI opens it in add mode on the active repo; Update CI config opens it for that installation's repo", () => {
    installations = { data: [inst({ repo: "acme/widgets" })] };
    renderTab({ realWizard: true });
    fireEvent.click(screen.getByRole("button", { name: /Add to CI/ }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Export to CI")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Target repository" })).toHaveValue("acme/active");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Add repository/ }));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Target repository" })).toHaveValue("acme/active");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Update CI config" }));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("combobox", { name: "Target repository" })).toBeNull();
    expect(within(dialog).getByText("Updating the CI config of acme/widgets.")).toBeInTheDocument();
  });
});

describe("CiTab helpers", () => {
  it("activeCount, isOutdated, ciRunsHref", () => {
    expect(activeCount([inst({ status: "active" }), inst({ status: "pending" }), inst({ status: "error" })])).toBe(1);
    expect(isOutdated(inst({ agent_version: 2 }), 3)).toBe(true);
    expect(isOutdated(inst({ agent_version: 3 }), 3)).toBe(false);
    expect(isOutdated(inst({ agent_version: null }), 3)).toBe(false);
    expect(ciRunsHref("a1", "acme/x y")).toBe("/ci-runs?agent_id=a1&repo=acme%2Fx+y");
  });
});
