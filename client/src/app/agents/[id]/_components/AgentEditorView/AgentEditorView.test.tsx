/**
 * AgentEditorView (/agents/:id) — unsaved Config edits when leaving the agent (the real editor,
 * hooks mocked): another agent card, a just-created agent and "Run on a PR"
 * ask first (Save and continue / Discard changes / Cancel); a failed save
 * stays with every edit; edits survive switching to the Skills tab.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import skillsMessages from "../../../../../../messages/en/skills.json";
import common from "../../../../../../messages/en/common.json";

const push = vi.fn();
const replace = vi.fn();
let params = new URLSearchParams("tab=config");
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "a1" }),
  useSearchParams: () => params,
  useRouter: () => ({ push, replace }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
const agent = (id: string, name: string): Agent => ({
  id,
  name,
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You review code.",
  output_schema: null,
  enabled: true,
  version: 1,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  skill_count: 0,
});
const AGENTS = [agent("a1", "Open Agent"), agent("a2", "Other Agent")];
const updateAsync = vi.fn();
const createAsync = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: AGENTS, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgent: () => ({ data: AGENTS[0], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useUpdateAgent: () => ({ mutate: vi.fn(), mutateAsync: updateAsync, isPending: false }),
  useDeleteAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateAgent: () => ({ mutateAsync: createAsync, isPending: false }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
  useAgentSkills: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useSetAgentSkills: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { AgentEditorView } from "./AgentEditorView";

const U = common.unsaved;
afterEach(() => {
  cleanup();
  push.mockReset();
  replace.mockReset();
  updateAsync.mockReset();
  createAsync.mockReset();
  params = new URLSearchParams("tab=config");
});

function ui() {
  return (
    <NextIntlClientProvider locale="en" messages={{ agents: messages, skills: skillsMessages, common }}>
      <AgentEditorView />
    </NextIntlClientProvider>
  );
}
const nameInput = () => screen.getByDisplayValue(/^Open Agent/) as HTMLInputElement;
const editName = () => fireEvent.change(nameInput(), { target: { value: "Open Agent v2" } });
const openOther = () => fireEvent.click(screen.getByRole("button", { name: "Open Other Agent" }));
const dialog = () => screen.queryByRole("dialog");

describe("Agent editor — unsaved Config edits", () => {
  it("no edits: another agent opens at once (keeping the tab)", () => {
    render(ui());
    openOther();
    expect(dialog()).toBeNull();
    expect(push).toHaveBeenCalledWith("/agents/a2?tab=config");
  });

  it("with edits: asks first; Cancel stays with the edits", () => {
    render(ui());
    editName();
    openOther();
    const d = within(dialog()!);
    for (const name of [U.save, U.discard, U.cancel]) expect(d.getByRole("button", { name })).toBeInTheDocument();
    fireEvent.click(d.getByRole("button", { name: U.cancel }));
    expect(dialog()).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("Open Agent v2");
  });

  it("Discard changes leaves without saving", () => {
    render(ui());
    editName();
    openOther();
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.discard }));
    expect(updateAsync).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/agents/a2?tab=config");
  });

  it("Save and continue saves only the changed fields, then opens the other agent", async () => {
    updateAsync.mockResolvedValue({ ...AGENTS[0], name: "Open Agent v2" });
    render(ui());
    editName();
    openOther();
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.save }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/agents/a2?tab=config"));
    expect(updateAsync).toHaveBeenCalledWith({ id: "a1", patch: { name: "Open Agent v2" } });
  });

  it("Save and continue with a server error stays and keeps every edit", async () => {
    updateAsync.mockRejectedValue(new Error("500"));
    render(ui());
    editName();
    openOther();
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.save }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(push).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("Open Agent v2");
  });

  it("Save and continue with invalid input sends nothing and shows the error", async () => {
    render(ui());
    fireEvent.change(nameInput(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Open Other Agent" }));
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.save }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(updateAsync).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(messages.config.errors.name)).toBeInTheDocument();
  });

  it("'Run on a PR' asks too when there are unsaved edits", () => {
    render(ui());
    editName();
    fireEvent.click(screen.getByRole("button", { name: messages.editor.runOnPr }));
    expect(dialog()).toHaveTextContent(U.title);
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.discard }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("edits survive switching to the Skills tab and back", () => {
    const view = render(ui());
    editName();
    params = new URLSearchParams("tab=skills");
    view.rerender(ui());
    expect(screen.getByRole("heading", { level: 2, name: messages.skills.title })).toBeInTheDocument();
    params = new URLSearchParams("tab=config");
    view.rerender(ui());
    expect(nameInput().value).toBe("Open Agent v2");
  });

  it("a new agent created from the list is opened through the same check", async () => {
    createAsync.mockResolvedValue(agent("a3", "Brand New"));
    render(ui());
    editName();
    fireEvent.click(screen.getByRole("button", { name: messages.list.addAgent }));
    fireEvent.click(screen.getByRole("button", { name: messages.list.createFromScratch }));
    const createDialog = screen.getByRole("dialog");
    fireEvent.click(within(createDialog).getByRole("button", { name: messages.create.create }));
    await waitFor(() => expect(dialog()).toHaveTextContent(U.title));
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.discard }));
    expect(push).toHaveBeenCalledWith("/agents/a3?tab=config");
  });
});
