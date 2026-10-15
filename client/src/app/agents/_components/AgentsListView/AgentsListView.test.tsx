/**
 * /agents (HW2 #7, #32, #34): each card shows the attached-skill count from
 * GET /agents (`skill_count`), and the card's delete opens DeleteAgentModal.
 * Hooks, the router and AppShell are mocked.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../messages/en/agents.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
const base = (id: string, name: string, skill_count: number): Agent => ({
  id,
  name,
  description: `${name} description`,
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "p",
  output_schema: null,
  enabled: true,
  version: 1,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  skill_count,
});
const AGENTS = [base("a1", "API Contract Reviewer", 4), base("a2", "Test Quality Reviewer", 0)];
const mutateAsync = vi.fn();
// One mock: "@/lib/hooks/agents" and the relative import resolve to the same module.
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: AGENTS, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateAgent: () => ({ mutate: vi.fn() }),
  useDeleteAgent: () => ({ mutateAsync, isPending: false }),
  useCreateAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProviderModels: () => ({ data: [] }),
}));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { AgentsListView } from "./AgentsListView";

afterEach(() => {
  cleanup();
  mutateAsync.mockReset();
  push.mockReset();
});

function renderView() {
  render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <AgentsListView />
    </NextIntlClientProvider>,
  );
}
const card = (name: string) => screen.getByText(name).closest("div[style]")!.parentElement as HTMLElement;

describe("AgentsListView", () => {
  it("shows each agent's attached-skill count from GET /agents", () => {
    renderView();
    expect(within(card("API Contract Reviewer")).getByText("4 skills")).toBeInTheDocument();
    expect(within(card("Test Quality Reviewer")).getByText("0 skills")).toBeInTheDocument();
  });

  it("delete opens the confirmation with that agent; confirming deletes it", async () => {
    mutateAsync.mockResolvedValue({ ok: true });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Delete API Contract Reviewer" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete “API Contract Reviewer”");
    expect(dialog).toHaveTextContent("4 skill links are removed");
    expect(push).not.toHaveBeenCalled(); // the card itself did not open
    fireEvent.click(within(dialog).getByRole("button", { name: messages.delete.confirm }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mutateAsync).toHaveBeenCalledWith("a1");
  });

  it("Cancel closes the confirmation without deleting", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Delete Test Quality Reviewer" }));
    fireEvent.click(screen.getByRole("button", { name: messages.delete.cancel }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
