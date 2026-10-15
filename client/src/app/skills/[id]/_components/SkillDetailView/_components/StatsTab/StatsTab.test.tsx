/**
 * StatsTab (Skill Editor · Stats): only real data — Used by = agent_count, the
 * agents using the skill (loading / error / empty states), "not tracked" for
 * the rest. A plain click on Open goes through the page's onNavigate (the
 * unsaved-edits check); a ctrl / cmd / middle click keeps the browser's own
 * new-tab behaviour.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

type U = { data: { agent: { id: string; name: string }; enabled: boolean }[]; isLoading: boolean; isError: boolean };
let using: U;
vi.mock("@/lib/hooks/agents", () => ({ useAgentsUsingSkill: () => using }));

import { StatsTab } from "./StatsTab";

const S = messages.detail.stats;
const SKILL = { id: "s1", name: "breaking-change", agent_count: 2 } as Skill;

beforeEach(() => {
  using = {
    data: [
      { agent: { id: "a1", name: "API Contract Reviewer" }, enabled: true },
      { agent: { id: "a2", name: "Security Reviewer" }, enabled: false },
    ],
    isLoading: false,
    isError: false,
  };
});
afterEach(cleanup);

function renderTab(onNavigate?: (href: string) => void) {
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <StatsTab skill={SKILL} onNavigate={onNavigate} />
    </NextIntlClientProvider>,
  );
}

describe("StatsTab", () => {
  it("Used by is the agent count; the other metrics say 'not tracked'; the categories panel is unavailable", () => {
    renderTab();
    expect(screen.getByRole("group", { name: S.usedBy })).toHaveTextContent("2agents");
    for (const label of [S.pullFrequency, S.acceptRate, S.findings30d]) {
      expect(screen.getByRole("group", { name: label })).toHaveTextContent(S.notTracked);
    }
    expect(screen.getByTestId("findings-by-category-unavailable")).toHaveTextContent(S.categoriesUnavailable);
  });

  it("lists the agents with Open links; an agent where the skill is switched off says so", () => {
    renderTab();
    expect(screen.getByRole("link", { name: "Open API Contract Reviewer" })).toHaveAttribute("href", "/agents/a1?tab=skills");
    expect(screen.getAllByText(S.offForAgent)).toHaveLength(1);
  });

  it("loading, error and no-agents states", () => {
    using = { data: [], isLoading: true, isError: false };
    renderTab();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(S.noAgents)).toBeNull();
    cleanup();

    using = { data: [], isLoading: false, isError: true };
    renderTab();
    expect(screen.getByText(S.agentsError)).toBeInTheDocument();
    expect(screen.queryByText(S.noAgents)).toBeNull();
    cleanup();

    using = { data: [], isLoading: false, isError: false };
    renderTab();
    expect(screen.getByText(S.noAgents)).toBeInTheDocument();
  });

  it("a plain click on Open goes through onNavigate; ctrl / cmd / middle clicks are left to the browser", () => {
    // jsdom can't follow real navigation; stop it after the app's own handler has run.
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("click", stop);
    const onNavigate = vi.fn();
    renderTab(onNavigate);
    const link = screen.getByRole("link", { name: "Open API Contract Reviewer" });
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { button: 1 });
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("/agents/a1?tab=skills");
    document.removeEventListener("click", stop);
  });
});
