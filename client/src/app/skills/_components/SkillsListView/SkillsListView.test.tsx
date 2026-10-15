/**
 * /skills view (HW2 #9–#12): grid from useSkills, search, empty / error states,
 * "Add Skill" menu (create enabled, import disabled), `?preview=<id>` drawer with
 * rendered Markdown, and the enabled toggle. Hooks, AppShell and the router are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/skills",
  useSearchParams: () => params,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

type Q = { data?: Skill[]; isLoading: boolean; isError: boolean; refetch: () => void };
let query: Q;
const mutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => query,
  useUpdateSkill: () => ({ mutate }),
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { SkillsListView } from "./SkillsListView";

function skill(id: string, o: Partial<Skill> = {}): Skill {
  return {
    id,
    name: id,
    description: `${id} description`,
    type: "rubric",
    source: "manual",
    body: `# ${id} heading\n\nUse **bold** rules.`,
    enabled: true,
    version: 1,
    evidence_files: null,
    agent_count: 0,
    ...o,
  };
}

const SKILLS = [
  skill("breaking-change", { type: "security", description: "API removals", agent_count: 2, version: 3 }),
  skill("naming", { type: "convention", description: "camelCase helpers", enabled: false }),
];

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillsListView />
    </NextIntlClientProvider>,
  );
}

const cards = () => Array.from(document.querySelectorAll("[data-skill-id]")).map((el) => el.getAttribute("data-skill-id"));

beforeEach(() => {
  query = { data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() };
  params = new URLSearchParams();
});
afterEach(() => {
  cleanup();
  replace.mockClear();
  mutate.mockClear();
});

describe("SkillsListView — grid", () => {
  it("renders one card per skill with its enabled switch", () => {
    renderView();
    expect(screen.getByRole("heading", { name: messages.page.heading })).toBeInTheDocument();
    expect(cards()).toEqual(["breaking-change", "naming"]);
    expect(screen.getByRole("switch", { name: "Enable naming" })).toHaveAttribute("aria-checked", "false");
  });

  it("search filters by name or description", () => {
    renderView();
    const input = screen.getByRole("textbox", { name: messages.page.searchPlaceholder });
    fireEvent.change(input, { target: { value: "camel" } });
    expect(cards()).toEqual(["naming"]);
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(cards()).toEqual([]);
    expect(screen.getByText(messages.page.noMatch.title)).toBeInTheDocument();
  });

  it("toggling a card PUTs only `enabled` and does not open the preview", () => {
    renderView();
    fireEvent.click(screen.getByRole("switch", { name: "Enable breaking-change" }));
    expect(mutate).toHaveBeenCalledWith({ id: "breaking-change", patch: { enabled: false } });
    expect(replace).not.toHaveBeenCalled();
  });

  it("empty: a create CTA; error: retry; loading: skeletons", () => {
    query = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    const { unmount } = renderView();
    expect(screen.getByText(messages.page.empty.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: messages.page.empty.cta }));
    expect(screen.getByRole("dialog")).toHaveTextContent(messages.create.title);
    unmount();

    const refetch = vi.fn();
    query = { data: undefined, isLoading: false, isError: true, refetch };
    renderView();
    expect(screen.getByText(messages.page.loadError)).toBeInTheDocument();
    cleanup();

    query = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    renderView();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(cards()).toEqual([]);
  });
});

describe("SkillsListView — Add Skill menu", () => {
  it("offers Create (opens the modal) and a disabled Import marked Coming soon", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: messages.page.addSkill }));
    const importItem = screen.getByRole("button", { name: new RegExp(messages.page.menu.fromFile) });
    expect(importItem).toBeDisabled();
    expect(importItem).toHaveTextContent(messages.page.menu.comingSoon);
    fireEvent.click(importItem);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: messages.page.menu.createFromScratch }));
    expect(screen.getByRole("dialog")).toHaveTextContent(messages.create.title);
  });
});

describe("SkillsListView — ?preview= side panel", () => {
  it("clicking a card sets ?preview=<id> (no page navigation)", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Preview breaking-change" }));
    expect(replace).toHaveBeenCalledWith("/skills?preview=breaking-change", { scroll: false });
  });

  it("?preview=<id> opens a right-side drawer with the body rendered as Markdown", () => {
    params = new URLSearchParams("preview=breaking-change");
    renderView();
    const drawer = screen.getByRole("dialog");
    expect(drawer).toHaveTextContent("breaking-change");
    expect(drawer).toHaveTextContent("v3");
    expect(drawer).toHaveTextContent("2 agents");
    const body = within(screen.getByTestId("skill-preview-body"));
    expect(body.getByRole("heading", { level: 1, name: "breaking-change heading" })).toBeInTheDocument();
    expect(body.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByTestId("skill-preview-body")).not.toHaveTextContent("# breaking-change");
    expect(document.querySelector("[data-skill-id='breaking-change']")).toHaveAttribute("data-active", "true");
  });

  it("closing (X or Escape) removes ?preview=", () => {
    params = new URLSearchParams("preview=naming");
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(replace).toHaveBeenLastCalledWith("/skills", { scroll: false });
    replace.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(replace).toHaveBeenCalledWith("/skills", { scroll: false });
  });

  it("an unknown id shows a not-found drawer instead of crashing", () => {
    params = new URLSearchParams("preview=missing");
    renderView();
    expect(screen.getByRole("dialog")).toHaveTextContent(messages.previewDrawer.notFound);
  });
});
