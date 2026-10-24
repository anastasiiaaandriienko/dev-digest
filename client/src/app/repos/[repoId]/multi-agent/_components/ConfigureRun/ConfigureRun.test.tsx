import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import multiAgent from "../../../../../../../messages/en/multiAgent.json";

/** L07 T9 — Configure run screen (AC-MAR-20, 25, 26, 28..31). Hooks mocked; no API. */

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));

let repoNotFound = false;
vi.mock("@/lib/repo-context", () => ({ useRepoNotFound: () => repoNotFound }));

type Q<T> = { data: T | undefined; isLoading?: boolean; isError?: boolean; refetch?: () => void };
let pullsQ: Q<unknown[]>;
let agentsQ: Q<unknown[]>;
let estimatesQ: Q<unknown[]>;
vi.mock("@/lib/hooks/core", () => ({ usePulls: () => pullsQ }));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => agentsQ }));

let mutateImpl: (v: { prId: string; agentIds: string[] }) => Promise<unknown> = async () => ({ runs: [] });
const mutateCalls: { prId: string; agentIds: string[] }[] = [];
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => estimatesQ,
  useStartMultiAgentRun: () => ({
    mutateAsync: (v: { prId: string; agentIds: string[] }) => {
      mutateCalls.push(v);
      return mutateImpl(v);
    },
    isPending: false,
  }),
}));

import { ConfigureRun } from "./ConfigureRun";

const agent = (n: number, enabled = true) => ({
  id: `a${n}`,
  name: `Agent ${n}`,
  description: `Description ${n}`,
  model: "m",
  enabled,
});

function renderScreen(prParam: string | null = "pr-482") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent }}>
      <ConfigureRun repoId="repo-1" prParam={prParam} />
    </NextIntlClientProvider>
  );
}

const card = (id: string) => screen.getByTestId(`agent-card-${id}`);
const box = (id: string) => within(card(id)).getByRole("checkbox");
const checked = (id: string) => box(id).getAttribute("aria-checked") === "true";
const cta = () => screen.getByRole("button", { name: /Run multi-agent review/ });

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  mutateCalls.length = 0;
  mutateImpl = async () => ({ runs: [] });
  repoNotFound = false;
  pullsQ = {
    data: [
      { id: "pr-482", number: 482, title: "Add rate limiting" },
      { id: "pr-490", number: 490, title: "Fix login" },
    ],
  };
  agentsQ = { data: [agent(1), agent(2), agent(3, false)] };
  estimatesQ = {
    data: [
      { agent_id: "a1", runs: 10, avg_duration_ms: 8200, avg_cost_usd: 0.04 },
      { agent_id: "a2", runs: 4, avg_duration_ms: 7100, avg_cost_usd: 0.05 },
      { agent_id: "a3", runs: 0, avg_duration_ms: null, avg_cost_usd: null },
    ],
  };
});
afterEach(cleanup);

describe("ConfigureRun", () => {
  it("AC-MAR-28: without a PR, step 2 says 'Pick a pull request first' and the CTA is disabled", () => {
    renderScreen(null);
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-card-a1")).not.toBeInTheDocument();
    expect(cta()).toBeDisabled();
  });

  it("AC-MAR-30: lists the stored PRs and preselects ?pr=; choosing another updates the URL", () => {
    renderScreen("pr-482");
    const select = screen.getByRole("combobox", { name: "Pull request" }) as HTMLSelectElement;
    expect(select.value).toBe("pr-482");
    expect(within(select).getByRole("option", { name: "#490 · Fix login" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "pr-490" } });
    expect(replace).toHaveBeenCalledWith("/repos/repo-1/multi-agent?pr=pr-490");
  });

  it("an unknown ?pr= shows a notice and nothing is selected", () => {
    renderScreen("pr-unknown");
    expect(screen.getByText(multiAgent.configure.unknownPr)).toBeInTheDocument();
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(cta()).toBeDisabled();
  });

  it("AC-MAR-29: one card per agent with description and estimate; enabled pre-checked", () => {
    renderScreen();
    expect(within(card("a1")).getByText("Description 1")).toBeInTheDocument();
    expect(within(card("a1")).getByText("≈ 8.2s · $0.04")).toBeInTheDocument();
    expect(within(card("a3")).getByText("no estimate")).toBeInTheDocument();
    expect(checked("a1") && checked("a2")).toBe(true);
    expect(checked("a3")).toBe(false);
    expect(cta()).toHaveTextContent("Run multi-agent review (2)");
  });

  it("AC-MAR-20: total = slowest + summed cost, labelled parallel; adding a no-history agent marks it partial", () => {
    renderScreen();
    expect(screen.getByTestId("estimate-total")).toHaveTextContent("≈ 8.2s · $0.09 · parallel");
    expect(screen.queryByText(multiAgent.configure.totalNote)).not.toBeInTheDocument();
    fireEvent.click(box("a3"));
    expect(screen.getByTestId("estimate-total")).toHaveTextContent("≈ 8.2s · $0.09 · parallel");
    expect(screen.getByText(multiAgent.configure.totalNote)).toBeInTheDocument();
  });

  it("only agents without estimates selected → 'no estimate' total", () => {
    renderScreen();
    fireEvent.click(box("a1"));
    fireEvent.click(box("a2"));
    fireEvent.click(box("a3"));
    expect(screen.getByTestId("estimate-total")).toHaveTextContent("no estimate");
  });

  it("toggling keeps pick order; Select all adds the rest; the CTA is disabled with none", async () => {
    renderScreen();
    fireEvent.click(box("a1"));
    fireEvent.click(box("a2"));
    expect(cta()).toBeDisabled();
    fireEvent.click(box("a3"));
    fireEvent.click(box("a1"));
    fireEvent.click(cta());
    await waitFor(() => expect(mutateCalls).toHaveLength(1));
    expect(mutateCalls[0]).toEqual({ prId: "pr-482", agentIds: ["a3", "a1"] });
  });

  it("Select all checks every agent", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(["a1", "a2", "a3"].every(checked)).toBe(true);
  });

  it("caps the selection at 8 agents", () => {
    agentsQ = { data: Array.from({ length: 10 }, (_, i) => agent(i + 1)) };
    renderScreen();
    expect(cta()).toHaveTextContent("Run multi-agent review (8)");
    expect(screen.getByText("Up to 8 agents per run")).toBeInTheDocument();
    fireEvent.click(box("a9"));
    expect(checked("a9")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(cta()).toHaveTextContent("Run multi-agent review (8)");
  });

  it("AC-MAR-25: a successful start opens the PR's Results page", async () => {
    renderScreen();
    fireEvent.click(cta());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482/multi-agent"));
    expect(mutateCalls).toEqual([{ prId: "pr-482", agentIds: ["a1", "a2"] }]);
  });

  it("AC-MAR-26: a failed start keeps the selection and does not navigate", async () => {
    mutateImpl = async () => Promise.reject(new Error("Agent not found"));
    renderScreen();
    fireEvent.click(box("a3"));
    fireEvent.click(cta());
    await waitFor(() => expect(mutateCalls).toHaveLength(1));
    expect(push).not.toHaveBeenCalled();
    expect(checked("a1") && checked("a2") && checked("a3")).toBe(true);
  });

  it("AC-MAR-31: no agents → empty state linking to Agents", () => {
    agentsQ = { data: [] };
    renderScreen();
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to Agents" }));
    expect(push).toHaveBeenCalledWith("/agents");
    expect(cta()).toBeDisabled();
  });

  it("loading and error states", () => {
    pullsQ = { data: undefined, isLoading: true };
    const { unmount } = renderScreen();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    unmount();
    const refetch = vi.fn();
    pullsQ = { data: undefined, isError: true, refetch };
    agentsQ = { data: undefined, refetch: vi.fn() };
    renderScreen();
    expect(screen.getByText(multiAgent.configure.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("estimates still loading: cards show no estimate text yet", () => {
    estimatesQ = { data: undefined, isLoading: true };
    renderScreen();
    expect(within(card("a1")).queryByText(/≈|no estimate/)).not.toBeInTheDocument();
  });

  it("unknown repo → repo not found", () => {
    repoNotFound = true;
    renderScreen();
    expect(screen.getByText("repo not found")).toBeInTheDocument();
  });
});
