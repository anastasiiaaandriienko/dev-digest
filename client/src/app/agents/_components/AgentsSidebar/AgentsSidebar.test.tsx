/**
 * AgentsSidebar (Agents list column): heading, Add Agent, search, the
 * selected card, opening a card, the enabled toggle (never opens the agent),
 * delete through DeleteAgentModal, and the error / cached-list states.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../messages/en/agents.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
const mutate = vi.fn();
type Q = { data?: Agent[]; isLoading: boolean; isError: boolean; refetch: () => void };
let query: Q;
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => query,
  useUpdateAgent: () => ({ mutate }),
  useDeleteAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProviderModels: () => ({ data: [] }),
}));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { AgentsSidebar } from "./AgentsSidebar";

const agent = (id: string, name: string, model: string, skill_count: number): Agent => ({
  id,
  name,
  description: `${name} description`,
  provider: "openrouter",
  model,
  system_prompt: "p",
  output_schema: null,
  enabled: true,
  version: 1,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  skill_count,
});
const AGENTS = [agent("a1", "Security Reviewer", "deepseek/deepseek-v4-flash", 3), agent("a2", "Mentor", "gpt-4.1", 1)];

beforeEach(() => {
  query = { data: AGENTS, isLoading: false, isError: false, refetch: vi.fn() };
});
afterEach(() => {
  cleanup();
  mutate.mockClear();
});

function renderSidebar(selectedId: string | null = "a1") {
  const onSelect = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <AgentsSidebar selectedId={selectedId} onSelect={onSelect} creating={false} onCreatingChange={vi.fn()} />
    </NextIntlClientProvider>,
  );
  return { onSelect };
}
const cards = () => Array.from(document.querySelectorAll("[data-agent-id]")).map((el) => el.getAttribute("data-agent-id"));

describe("AgentsSidebar", () => {
  it("cards show name, model chip and skill count; the open agent is highlighted", () => {
    renderSidebar();
    expect(cards()).toEqual(["a1", "a2"]);
    expect(document.querySelector("[data-agent-id='a1']")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("deepseek/deepseek-v4-flash")).toBeInTheDocument();
    expect(screen.getByText("3 skills")).toBeInTheDocument();
  });

  it("a card opens its agent; the toggle only flips `enabled`; delete asks for confirmation", () => {
    const { onSelect } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Open Mentor" }));
    expect(onSelect).toHaveBeenCalledWith("a2");
    onSelect.mockClear();
    fireEvent.click(screen.getByRole("switch", { name: "Enable Security Reviewer" }));
    expect(mutate).toHaveBeenCalledWith({ id: "a1", patch: { enabled: false } });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete Mentor" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Mentor");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("search filters by name or description, and says when nothing matches", () => {
    renderSidebar();
    const box = screen.getByRole("textbox", { name: messages.list.searchPlaceholder });
    fireEvent.change(box, { target: { value: "mentor" } });
    expect(cards()).toEqual(["a2"]);
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText(messages.list.noMatchTitle)).toBeInTheDocument();
  });

  it("a failed background refetch keeps the cached list; with nothing cached it offers Retry", () => {
    query = { data: AGENTS, isLoading: false, isError: true, refetch: vi.fn() };
    renderSidebar();
    expect(cards()).toEqual(["a1", "a2"]);
    expect(screen.queryByText(messages.list.loadError)).toBeNull();
    cleanup();
    query = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
    renderSidebar();
    expect(screen.getByText(messages.list.loadError)).toBeInTheDocument();
  });
});
