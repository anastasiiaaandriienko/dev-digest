import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../messages/en/agents.json";
import { AgentCard } from "./AgentCard";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AgentCard (smoke)", () => {
  it("renders the agent name, model chip and skill count", () => {
    renderWithIntl(<AgentCard ag={AGENT} skillCount={3} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("3 skills")).toBeInTheDocument();
  });

  it("falls back to a translated placeholder when description is empty", () => {
    renderWithIntl(<AgentCard ag={{ ...AGENT, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });
});

describe("AgentCard — skill count (HW2 #32) and delete (HW2 #33/#34)", () => {
  it("pluralizes the attached-skill count, including 0", () => {
    renderWithIntl(<AgentCard ag={AGENT} skillCount={1} />);
    expect(screen.getByText("1 skill")).toBeInTheDocument();
    cleanup();
    renderWithIntl(<AgentCard ag={AGENT} skillCount={0} />);
    expect(screen.getByText("0 skills")).toBeInTheDocument();
  });

  it("delete asks the parent (no window.confirm) and never opens the agent", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const onDelete = vi.fn();
    const onClick = vi.fn();
    renderWithIntl(<AgentCard ag={AGENT} onClick={onClick} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Security Reviewer" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("no delete button without onDelete", () => {
    renderWithIntl(<AgentCard ag={AGENT} />);
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });
});
