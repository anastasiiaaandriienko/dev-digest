import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import contextMessages from "../../../../../../messages/en/context.json";
import evalMessages from "../../../../../../messages/en/eval.json";
import ciMessages from "../../../../../../messages/en/ci.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
  useAgentSkills: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useSetAgentSkills: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/hooks/context", () => ({
  useContextList: () => ({
    data: { files: [{ path: "docs/spec.md", size: 1024, updated_at: "x" }], roots: ["docs"], truncated: false, truncated_reasons: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useContextDocs: () => ({ data: [], isError: false }),
  useContextFile: () => ({ data: undefined, isLoading: false, isError: false }),
  useAttachContextDoc: () => ({ mutate: vi.fn(), isPending: false }),
  useDetachContextDoc: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderContextDocs: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
// L06 Evals tab: counts reads, so a test can prove other tabs never fetch eval data.
const evalReads = { cases: 0, runs: 0 };
vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalCases: () => {
    evalReads.cases++;
    return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  },
  useAgentEvalRuns: () => {
    evalReads.runs++;
    return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  },
  useStartEvalRun: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
// L07 CI tab: counts reads, so a test can prove other tabs never read CI data or sync.
const ciReads = { installations: 0, autoSync: 0 };
vi.mock("@/lib/hooks/ci", () => ({
  useCiInstallations: () => {
    ciReads.installations++;
    return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  },
  useCiAutoSync: () => {
    ciReads.autoSync++;
  },
  useCiSync: () => ({ mutate: vi.fn() }),
}));
// Repo fixture so the Context tab does not take the no-repo branch (AC-CTX-93).
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1", repos: [{ id: "r1", name: "api", full_name: "acme/api" }] }),
}));

import { AgentEditor } from "./AgentEditor";

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
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, context: contextMessages, eval: evalMessages, ci: ciMessages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });
});

describe("Agent Editor tabs (HW2 #35)", () => {
  it("AC-CTX-77 + AC-EVAL-29 + AC-CI-60: Config, Skills, Context, Evals and CI (no Stats yet)", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    const tabs = ["Config", "Skills", "Context", "Evals", "Stats", "CI"].filter((name) =>
      screen.queryByRole("button", { name }),
    );
    expect(tabs).toEqual(["Config", "Skills", "Context", "Evals", "CI"]);
  });

  it("AC-CI-60 tab=ci shows the CI tab; Config stays mounted but hidden; other tabs read no CI data and never sync", () => {
    ciReads.installations = 0;
    ciReads.autoSync = 0;
    for (const tab of ["config", "skills", "context", "evals"]) {
      const { unmount } = renderWithIntl(<AgentEditor agent={AGENT} tab={tab} onTab={() => {}} />);
      unmount();
    }
    expect(ciReads).toEqual({ installations: 0, autoSync: 0 });
    const onTab = vi.fn();
    renderWithIntl(<AgentEditor agent={AGENT} tab="ci" onTab={onTab} />);
    expect(screen.getByRole("heading", { level: 2, name: ciMessages.ciTab.heading })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save agent" })).toBeNull();
    expect(screen.getByDisplayValue("Security Reviewer")).not.toBeVisible();
    expect(ciReads.installations).toBeGreaterThan(0);
    expect(ciReads.autoSync).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Evals" }));
    expect(onTab).toHaveBeenCalledWith("evals");
  });

  it("tab=evals shows the Evals tab; Config stays mounted but hidden; other tabs read no eval data", () => {
    evalReads.cases = 0;
    evalReads.runs = 0;
    const { unmount } = renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(evalReads).toEqual({ cases: 0, runs: 0 });
    unmount();
    renderWithIntl(<AgentEditor agent={AGENT} tab="evals" onTab={() => {}} />);
    expect(screen.getByRole("heading", { level: 2, name: evalMessages.evalsTab.casesHeading })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save agent" })).toBeNull();
    expect(screen.getByDisplayValue("Security Reviewer")).not.toBeVisible();
    expect(evalReads.cases).toBeGreaterThan(0);
  });

  it("AC-CTX-80 tab=context hides Save agent while Config stays mounted", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="context" onTab={() => {}} />);
    expect(screen.getByRole("heading", { level: 2, name: contextMessages.agentTab.title })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save agent" })).toBeNull();
    // Mounted but hidden: the Config form is still in the DOM.
    expect(screen.getByDisplayValue("Security Reviewer")).not.toBeVisible();
  });

  it("tab=skills shows the Skills tab; clicking a tab reports it", () => {
    const onTab = vi.fn();
    renderWithIntl(<AgentEditor agent={AGENT} tab="skills" onTab={onTab} />);
    expect(screen.getByRole("heading", { level: 2, name: "Skills" })).toBeInTheDocument();
    // Config stays mounted but hidden (its unsaved edits survive the tab switch)
    expect(screen.queryByRole("button", { name: "Save agent" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Config" }));
    expect(onTab).toHaveBeenCalledWith("config");
  });
});
