/**
 * SkillsSidebar (Skills Lab list column): heading, search, the selected card,
 * opening a card, the enabled toggle (never opens the skill), and the Add
 * Skill menu whose modals hand the new skill to onSelect. Hooks are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

const mutate = vi.fn();
type Q = { data?: Skill[]; isLoading: boolean; isError: boolean; refetch: () => void };
let query: Q;
const createAsync = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => query,
  useUpdateSkill: () => ({ mutate }),
  useCreateSkill: () => ({ mutateAsync: createAsync, isPending: false }),
  usePreviewSkillImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportSkills: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { SkillsSidebar } from "./SkillsSidebar";

const skill = (id: string, description: string): Skill => ({
  id,
  name: id,
  description,
  type: "rubric",
  source: "manual",
  body: "# x",
  enabled: true,
  version: 1,
  evidence_files: null,
  agent_count: 0,
});
const SKILLS = [skill("alpha", "first rule"), skill("beta", "second rule")];

beforeEach(() => {
  query = { data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() };
});
afterEach(() => {
  cleanup();
  mutate.mockClear();
  createAsync.mockReset();
});

function renderSidebar(selectedId: string | null = "beta") {
  const onSelect = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillsSidebar selectedId={selectedId} onSelect={onSelect} />
    </NextIntlClientProvider>,
  );
  return { onSelect };
}
const cards = () => Array.from(document.querySelectorAll("[data-skill-id]")).map((el) => el.getAttribute("data-skill-id"));

describe("SkillsSidebar", () => {
  it("lists the skills with the selected one highlighted; search filters", () => {
    renderSidebar();
    expect(screen.getByRole("heading", { name: messages.page.heading })).toBeInTheDocument();
    expect(cards()).toEqual(["alpha", "beta"]);
    expect(document.querySelector("[data-skill-id='beta']")).toHaveAttribute("data-active", "true");
    fireEvent.change(screen.getByRole("textbox", { name: messages.page.searchPlaceholder }), { target: { value: "first" } });
    expect(cards()).toEqual(["alpha"]);
  });

  it("a card opens its skill; the toggle only flips `enabled`", () => {
    const { onSelect } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Open alpha" }));
    expect(onSelect).toHaveBeenCalledWith("alpha");
    onSelect.mockClear();
    fireEvent.click(screen.getByRole("switch", { name: "Enable beta" }));
    expect(mutate).toHaveBeenCalledWith({ id: "beta", patch: { enabled: false } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Add Skill offers Import from file and Create from scratch; a created skill is selected", async () => {
    createAsync.mockResolvedValue({ ...skill("gamma", ""), id: "new-id" });
    const { onSelect } = renderSidebar(null);
    fireEvent.click(screen.getByRole("button", { name: messages.page.addSkill }));
    expect(screen.getByRole("button", { name: new RegExp(messages.page.menu.fromFile) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: messages.page.menu.createFromScratch }));
    expect(screen.getByRole("dialog")).toHaveTextContent(messages.create.title);
    fireEvent.change(screen.getByPlaceholderText(messages.create.namePlaceholder), { target: { value: "gamma" } });
    fireEvent.change(screen.getByPlaceholderText(/# Rule/), { target: { value: "# Gamma" } });
    fireEvent.click(screen.getByRole("button", { name: messages.create.submit }));
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith("new-id"));
  });

  it("a failed background refetch keeps the cached list (no error screen); with nothing cached it offers Retry", () => {
    query = { data: SKILLS, isLoading: false, isError: true, refetch: vi.fn() };
    renderSidebar();
    expect(cards()).toEqual(["alpha", "beta"]);
    expect(screen.queryByText(messages.page.loadError)).toBeNull();
    cleanup();
    const refetch = vi.fn();
    query = { data: undefined, isLoading: false, isError: true, refetch };
    renderSidebar();
    expect(screen.getByText(messages.page.loadError)).toBeInTheDocument();
    expect(screen.queryByText(messages.page.empty.title)).toBeNull();
  });
});
