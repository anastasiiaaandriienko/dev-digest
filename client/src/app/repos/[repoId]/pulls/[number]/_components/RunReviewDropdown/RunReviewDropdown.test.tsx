import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import prReview from "../../../../../../../../messages/en/prReview.json";
import multiAgent from "../../../../../../../../messages/en/multiAgent.json";

/** L07 T8 — the PR page's multi-agent picker (AC-MAR-21..26). Hooks are mocked; no API. */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

type A = { id: string; name: string; model: string; enabled: boolean };
let agents: A[] | undefined = [];
vi.mock("../../../../../../../lib/hooks/agents", () => ({ useAgents: () => ({ data: agents }) }));

let mutateImpl: (v: { prId: string; agentIds: string[] }) => Promise<unknown> = async () => ({ runs: [] });
const mutateCalls: { prId: string; agentIds: string[] }[] = [];
vi.mock("../../../../../../../lib/hooks/multi-agent", () => ({
  useStartMultiAgentRun: () => ({
    mutateAsync: (v: { prId: string; agentIds: string[] }) => {
      mutateCalls.push(v);
      return mutateImpl(v);
    },
    isPending: false,
  }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

const agent = (n: number, enabled = true): A => ({ id: `a${n}`, name: `Agent ${n}`, model: `model-${n}`, enabled });

function renderPicker(props: Partial<React.ComponentProps<typeof RunReviewDropdown>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, multiAgent }}>
      <RunReviewDropdown prId="pr-1" repoId="repo-1" prNumber={482} {...props} />
    </NextIntlClientProvider>
  );
}

const open = () => fireEvent.click(screen.getByRole("button", { name: /Run Review/ }));
const box = (id: string) => within(screen.getByTestId(`pick-${id}`)).getByRole("checkbox");
const checked = (id: string) => box(id).getAttribute("aria-checked") === "true";
const cta = () => screen.getByRole("button", { name: /Run multi-agent review/ });

beforeEach(() => {
  push.mockReset();
  mutateCalls.length = 0;
  mutateImpl = async () => ({ runs: [] });
  agents = [agent(1), agent(2), agent(3, false)];
});
afterEach(cleanup);

describe("RunReviewDropdown — multi-agent picker", () => {
  it("renders the trigger; opening lists every agent under PICK AGENTS TO RUN (AC-MAR-21)", () => {
    renderPicker();
    expect(screen.getByText("Run Review")).toBeInTheDocument();
    expect(screen.queryByText("PICK AGENTS TO RUN")).not.toBeInTheDocument();
    open();
    expect(screen.getByText("PICK AGENTS TO RUN")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(checked("a1") && checked("a2")).toBe(true);
    expect(checked("a3")).toBe(false);
    expect(screen.getByText("model-3 · disabled")).toBeInTheDocument();
  });

  it("disabled agents are still checkable; the CTA counts the checked agents (AC-MAR-22)", () => {
    renderPicker();
    open();
    expect(cta()).toHaveTextContent("Run multi-agent review (2)");
    fireEvent.click(box("a3"));
    expect(checked("a3")).toBe(true);
    expect(cta()).toHaveTextContent("Run multi-agent review (3)");
  });

  it("Clear unchecks every agent and the CTA is disabled with none selected (AC-MAR-22, 23)", () => {
    renderPicker();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(["a1", "a2", "a3"].some(checked)).toBe(false);
    expect(cta()).toHaveTextContent("Run multi-agent review (0)");
    expect(cta()).toBeDisabled();
  });

  it("a single selected agent runs a one-agent review and opens the Results page (AC-MAR-25)", async () => {
    mutateImpl = async () => ({ runs: [{ run_id: "r1", agent_id: "a2", agent_name: "Agent 2" }] });
    const onRunsStarted = vi.fn();
    renderPicker({ onRunsStarted });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(box("a2"));
    fireEvent.click(cta());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482/multi-agent"));
    expect(mutateCalls).toEqual([{ prId: "pr-1", agentIds: ["a2"] }]);
    expect(onRunsStarted).toHaveBeenCalledWith(["r1"]);
  });

  it("several agents are sent in pick order (= column order)", async () => {
    renderPicker();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(box("a3"));
    fireEvent.click(box("a1"));
    fireEvent.click(cta());
    await waitFor(() => expect(mutateCalls).toHaveLength(1));
    expect(mutateCalls[0]!.agentIds).toEqual(["a3", "a1"]);
  });

  it("caps the selection at 8 agents: only 8 are pre-checked and a 9th cannot be checked", () => {
    agents = Array.from({ length: 10 }, (_, i) => agent(i + 1));
    renderPicker();
    open();
    expect(screen.getAllByRole("checkbox").filter((b) => b.getAttribute("aria-checked") === "true")).toHaveLength(8);
    expect(cta()).toHaveTextContent("Run multi-agent review (8)");
    expect(screen.getByText("Up to 8 agents per run")).toBeInTheDocument();
    fireEvent.click(box("a9"));
    expect(checked("a9")).toBe(false);
    // Freeing a slot makes the 9th checkable again.
    fireEvent.click(box("a1"));
    fireEvent.click(box("a9"));
    expect(checked("a9")).toBe(true);
    expect(cta()).toHaveTextContent("Run multi-agent review (8)");
  });

  it("a failed start keeps the selection and the picker open, and does not navigate (AC-MAR-26)", async () => {
    mutateImpl = async () => Promise.reject(new Error("Agent not found"));
    const onRunSettled = vi.fn();
    renderPicker({ onRunSettled });
    open();
    fireEvent.click(box("a3"));
    fireEvent.click(cta());
    await waitFor(() => expect(onRunSettled).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("PICK AGENTS TO RUN")).toBeInTheDocument();
    expect(checked("a1") && checked("a2") && checked("a3")).toBe(true);
    expect(cta()).toHaveTextContent("Run multi-agent review (3)");
  });

  it("an empty agent list shows a hint with a link to Agents and a disabled CTA", () => {
    agents = [];
    renderPicker();
    open();
    expect(screen.getByText("No agents yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    expect(cta()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Go to Agents" }));
    expect(push).toHaveBeenCalledWith("/agents");
  });

  it("while agents are loading nothing is pre-checked and the CTA is disabled", () => {
    agents = undefined;
    renderPicker();
    open();
    expect(cta()).toBeDisabled();
  });

  it("Configure agents… opens Configure run with ?pr= (AC-MAR-24)", () => {
    renderPicker();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Configure agents…" }));
    expect(push).toHaveBeenCalledWith("/repos/repo-1/multi-agent?pr=pr-1");
  });

  it("keeps the merged/closed warning", () => {
    renderPicker({ warnMerged: true });
    open();
    expect(screen.getByText(prReview.runReview.mergedWarning)).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    renderPicker();
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("PICK AGENTS TO RUN")).not.toBeInTheDocument();
  });
});
