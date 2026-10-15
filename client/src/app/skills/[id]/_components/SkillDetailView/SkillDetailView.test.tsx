/**
 * /skills/:id (HW2 #25, #26; design: Skills Lab list + editor): the list column
 * next to the editor with this skill highlighted (another card keeps the tab),
 * the Config / Preview / Evals / Stats / Versions tabs kept in `?tab=`, the
 * rendered Preview, the truthful Evals / Stats states, loading / 404 / error
 * states, delete from the Config tab returning to /skills, and the
 * unsaved-changes guard (Save and continue / Discard / Cancel when switching
 * skills; edits survive failed saves and tab switches). Hooks, AppShell and the
 * router are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";

const replace = vi.fn();
const push = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  useParams: () => ({ id: "s1" }),
  useSearchParams: () => params,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));


type Q = { data?: Skill; isLoading: boolean; isError: boolean; error?: unknown; refetch: () => void };
let query: Q;
const deleteAsync = vi.fn();
const updateAsync = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useSkill: () => query,
  useSkills: () => ({ data: [SKILL, OTHER], isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutateAsync: updateAsync, mutate: vi.fn(), isPending: false }),
  useSkillVersions: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: deleteAsync, isPending: false }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgentsUsingSkill: () => ({
    data: [{ agent: { id: "ag1", name: "API Contract Reviewer" }, enabled: true }],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ApiError } from "@/lib/api";
import { SkillDetailView } from "./SkillDetailView";

const SKILL: Skill = {
  id: "s1",
  name: "breaking-change",
  description: "Flag API removals",
  type: "security",
  source: "manual",
  body: "# Breaking change\n\nFlag **removed** fields.",
  enabled: true,
  version: 3,
  evidence_files: null,
  agent_count: 2,
};
const OTHER: Skill = { ...SKILL, id: "s2", name: "naming", type: "convention", agent_count: 0 };
const T = messages.detail.tabs;
const ALL_TABS = [T.config, T.preview, T.evals, T.stats, T.versioning];

beforeEach(() => {
  query = { data: SKILL, isLoading: false, isError: false, refetch: vi.fn() };
  params = new URLSearchParams();
});
afterEach(() => {
  cleanup();
  replace.mockClear();
  push.mockClear();
  deleteAsync.mockReset();
  updateAsync.mockReset();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillDetailView />
    </NextIntlClientProvider>,
  );
}

const tabButtons = () => ALL_TABS.map((name) => screen.queryByRole("button", { name }));

describe("SkillDetailView — tabs", () => {
  it("shows the header and the Config / Preview / Evals / Stats / Versions tabs, Config by default", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "breaking-change" })).toBeInTheDocument();
    const header = screen.getByRole("heading", { level: 1 }).parentElement!;
    expect(within(header).getByText("security")).toBeInTheDocument();
    expect(within(header).getByText("v3")).toBeInTheDocument();
    expect(tabButtons().every(Boolean)).toBe(true);
    expect(screen.getByRole("heading", { level: 2, name: messages.detail.config.title })).toBeInTheDocument();
    // No eval API: no "Run on evals" action is offered.
    expect(screen.queryByRole("button", { name: /run on evals/i })).toBeNull();
  });

  it("clicking a tab writes ?tab= (keeping other params)", () => {
    params = new URLSearchParams("x=1");
    renderView();
    fireEvent.click(screen.getByRole("button", { name: T.versioning }));
    expect(replace).toHaveBeenCalledWith("/skills/s1?x=1&tab=versioning", { scroll: false });
  });

  it("?tab=preview renders the body as Markdown (not raw text)", () => {
    params = new URLSearchParams("tab=preview");
    renderView();
    const body = within(screen.getByTestId("skill-rendered-body"));
    expect(body.getByRole("heading", { level: 1, name: "Breaking change" })).toBeInTheDocument();
    expect(body.getByText("removed").tagName).toBe("STRONG");
    expect(screen.getByTestId("skill-rendered-body")).not.toHaveTextContent("**");
  });

  it("?tab=versioning shows the history; an unknown tab falls back to Config", () => {
    params = new URLSearchParams("tab=versioning");
    const { unmount } = renderView();
    expect(screen.getByRole("heading", { level: 2, name: messages.detail.versioning.title })).toBeInTheDocument();
    unmount();
    params = new URLSearchParams("tab=ci");
    renderView();
    expect(screen.getByRole("heading", { level: 2, name: messages.detail.config.title })).toBeInTheDocument();
  });
});

describe("SkillDetailView — list column", () => {
  it("lists the skills with this one highlighted; picking another keeps the open tab", () => {
    params = new URLSearchParams("tab=preview");
    renderView();
    expect(document.querySelector("[data-skill-id='s1']")).toHaveAttribute("data-active", "true");
    expect(document.querySelector("[data-skill-id='s2']")).not.toHaveAttribute("data-active");
    fireEvent.click(screen.getByRole("button", { name: "Open naming" }));
    expect(push).toHaveBeenCalledWith("/skills/s2?tab=preview");
  });
});

describe("SkillDetailView — Evals and Stats show only real data", () => {
  it("Evals: no eval API, so an 'unavailable' state and no fake cases or run buttons", () => {
    params = new URLSearchParams("tab=evals");
    renderView();
    expect(screen.getByRole("heading", { level: 2, name: messages.detail.evals.title })).toBeInTheDocument();
    expect(screen.getByTestId("evals-unavailable")).toHaveTextContent(messages.detail.evals.unavailableTitle);
    expect(screen.queryByRole("button", { name: /run all evals|new eval case/i })).toBeNull();
  });

  it("Stats: Used by = agent_count, the agents using it with Open links, the rest 'not tracked'", () => {
    params = new URLSearchParams("tab=stats");
    renderView();
    const S = messages.detail.stats;
    expect(screen.getByRole("group", { name: S.usedBy })).toHaveTextContent("2agents");
    for (const label of [S.pullFrequency, S.acceptRate, S.findings30d]) {
      expect(screen.getByRole("group", { name: label })).toHaveTextContent(S.notTracked);
    }
    expect(screen.getByRole("link", { name: "Open API Contract Reviewer" })).toHaveAttribute("href", "/agents/ag1?tab=skills");
    expect(screen.getByTestId("findings-by-category-unavailable")).toHaveTextContent(S.categoriesUnavailable);
    // never a sample percentage or money figure
    expect(document.body.textContent).not.toMatch(/\d+%|\$\d/);
  });
});

describe("SkillDetailView — states", () => {
  it("loading → skeleton; 404 → not found; other errors → retry", () => {
    query = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    const r1 = renderView();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    r1.unmount();

    query = { data: undefined, isLoading: false, isError: true, error: new ApiError("Not found", 404), refetch: vi.fn() };
    const r2 = renderView();
    expect(screen.getByText(messages.detail.notFound.title)).toBeInTheDocument();
    r2.unmount();

    query = { data: undefined, isLoading: false, isError: true, error: new ApiError("Boom", 500), refetch: vi.fn() };
    renderView();
    expect(screen.getByText(messages.detail.loadError)).toBeInTheDocument();
    expect(tabButtons().every((b) => b === null)).toBe(true);
  });
});

describe("SkillDetailView — background refetch error", () => {
  it("keeps showing the cached skill (no error screen) when a refetch fails", () => {
    query = { data: SKILL, isLoading: false, isError: true, error: new ApiError("Boom", 500), refetch: vi.fn() };
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "breaking-change" })).toBeInTheDocument();
    expect(screen.queryByText(messages.detail.loadError)).toBeNull();
    expect(screen.queryByText(messages.detail.notFound.title)).toBeNull();
  });
});

describe("SkillDetailView — delete", () => {
  it("Config's Delete opens the shared confirmation and, once confirmed, returns to /skills", async () => {
    deleteAsync.mockResolvedValue({ ok: true });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: messages.detail.config.delete }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("breaking-change");
    expect(dialog).toHaveTextContent("removed from 2 agents");
    fireEvent.click(within(dialog).getByRole("button", { name: messages.delete.confirm }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/skills"));
    expect(deleteAsync).toHaveBeenCalledWith("s1");
  });
});

describe("SkillDetailView — unsaved Config edits when switching skills", () => {
  const U = messages.unsaved;
  const nameInput = () => screen.getByDisplayValue(/^breaking-change/) as HTMLInputElement;
  const editName = (value = "breaking-change-v2") => fireEvent.change(nameInput(), { target: { value } });
  const openOther = () => fireEvent.click(screen.getByRole("button", { name: "Open naming" }));
  const dialog = () => screen.queryByRole("dialog");

  it("no edits: switching skills navigates at once, no dialog", () => {
    renderView();
    openOther();
    expect(dialog()).toBeNull();
    expect(push).toHaveBeenCalledWith("/skills/s2?tab=config");
  });

  it("with edits: asks first and offers Save and continue, Discard changes and Cancel", () => {
    renderView();
    editName();
    openOther();
    const d = within(dialog()!);
    expect(dialog()).toHaveTextContent(U.title);
    expect(dialog()).toHaveTextContent("breaking-change");
    for (const name of [U.save, U.discard, U.cancel]) expect(d.getByRole("button", { name })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("Cancel stays on the skill with the edits untouched", () => {
    renderView();
    editName();
    openOther();
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.cancel }));
    expect(dialog()).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("breaking-change-v2");
  });

  it("Discard changes leaves without saving", () => {
    renderView();
    editName();
    openOther();
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.discard }));
    expect(updateAsync).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/skills/s2?tab=config");
  });

  it("Save and continue saves the changed fields, then opens the other skill", async () => {
    updateAsync.mockResolvedValue({ ...SKILL, name: "breaking-change-v2" });
    renderView();
    editName();
    openOther();
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.save }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/skills/s2?tab=config"));
    expect(updateAsync).toHaveBeenCalledWith({ id: "s1", patch: { name: "breaking-change-v2" } });
  });

  it("Save and continue with a server error stays on the skill and keeps every edit", async () => {
    updateAsync.mockRejectedValue(new Error("500"));
    renderView();
    editName();
    openOther();
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.save }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(updateAsync).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("breaking-change-v2");
  });

  it("Save and continue with invalid input sends nothing, shows the error and keeps the edits", async () => {
    renderView();
    fireEvent.change(nameInput(), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: messages.detail.config.body }), { target: { value: "# Edited" } });
    openOther();
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.save }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(updateAsync).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(messages.create.errors.name)).toBeInTheDocument();
    expect((screen.getByRole("textbox", { name: messages.detail.config.body }) as HTMLTextAreaElement).value).toBe("# Edited");
  });

  it("edits survive switching tabs, and are still guarded from another tab", async () => {
    const view = renderView();
    editName();
    params = new URLSearchParams("tab=preview");
    view.rerender(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <SkillDetailView />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("skill-rendered-body")).toBeInTheDocument();
    // leaving from Preview still asks; a failed save brings Config back into view
    updateAsync.mockRejectedValue(new Error("500"));
    openOther();
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.save }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/skills/s1?tab=config", { scroll: false }));
    expect(push).not.toHaveBeenCalled();
    params = new URLSearchParams("tab=config");
    view.rerender(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <SkillDetailView />
      </NextIntlClientProvider>,
    );
    expect(nameInput().value).toBe("breaking-change-v2");
  });

  it("unsaved Config edits block Restore on the Versions tab", () => {
    const view = renderView();
    editName();
    params = new URLSearchParams("tab=versioning");
    view.rerender(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <SkillDetailView />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("restore-blocked")).toHaveTextContent(messages.detail.versioning.restoreBlocked);
  });

  it("without edits the Versions tab has no Restore block", () => {
    params = new URLSearchParams("tab=versioning");
    renderView();
    expect(screen.queryByTestId("restore-blocked")).toBeNull();
  });

  it("the Stats tab's agent link asks too when Config has unsaved edits (and goes straight there without)", () => {
    const view = renderView();
    editName();
    params = new URLSearchParams("tab=stats");
    view.rerender(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <SkillDetailView />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Open API Contract Reviewer" }));
    expect(dialog()).toHaveTextContent(U.title);
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(within(dialog()!).getByRole("button", { name: U.discard }));
    expect(push).toHaveBeenCalledWith("/agents/ag1?tab=skills");
  });

  it("without edits the Stats agent link navigates at once", () => {
    params = new URLSearchParams("tab=stats");
    renderView();
    fireEvent.click(screen.getByRole("link", { name: "Open API Contract Reviewer" }));
    expect(dialog()).toBeNull();
    expect(push).toHaveBeenCalledWith("/agents/ag1?tab=skills");
  });
});
