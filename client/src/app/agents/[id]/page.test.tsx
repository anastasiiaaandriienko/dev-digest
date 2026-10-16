/**
 * /agents/:id side list (HW2 #32, #34): cards show the attached-skill count;
 * deleting the agent that is open leaves its page for /agents, deleting
 * another one stays. Hooks, the router, AppShell and the editor are mocked.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../messages/en/agents.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "a1" }),
  useSearchParams: () => new URLSearchParams("tab=config"),
  useRouter: () => ({ push, replace: vi.fn() }),
}));
vi.mock("../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./_components/AgentEditor", () => ({ AgentEditor: () => <div data-testid="editor" /> }));
const agent = (id: string, name: string, skill_count: number): Agent => ({
  id,
  name,
  description: "",
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
const AGENTS = [agent("a1", "Open Agent", 2), agent("a2", "Other Agent", 5)];
const mutateAsync = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: AGENTS }),
  useAgent: () => ({ data: AGENTS[0], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useUpdateAgent: () => ({ mutate: vi.fn() }),
  useDeleteAgent: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import AgentEditorPage from "./page";

afterEach(() => {
  cleanup();
  push.mockReset();
  mutateAsync.mockReset();
});

function renderPage() {
  render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <AgentEditorPage />
    </NextIntlClientProvider>,
  );
}
const confirmDelete = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name: `Delete ${name}` }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: messages.delete.confirm }));
};

describe("Agent page — side list", () => {
  it("cards show the attached-skill counts", () => {
    renderPage();
    expect(screen.getByText("2 skills")).toBeInTheDocument();
    expect(screen.getByText("5 skills")).toBeInTheDocument();
  });

  it("deleting the agent that is open goes back to /agents", async () => {
    mutateAsync.mockResolvedValue({ ok: true });
    renderPage();
    confirmDelete("Open Agent");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/agents"));
    expect(mutateAsync).toHaveBeenCalledWith("a1");
  });

  it("deleting another agent stays on this page", async () => {
    mutateAsync.mockResolvedValue({ ok: true });
    renderPage();
    confirmDelete("Other Agent");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mutateAsync).toHaveBeenCalledWith("a2");
    expect(push).not.toHaveBeenCalled();
  });
});
