/**
 * /skills/:id (HW2 #25, #26): exactly Config / Preview / Versioning tabs kept in
 * `?tab=`, the rendered Preview, loading / 404 / error states, and delete from
 * the Config tab returning to /skills. Hooks, AppShell and the router are mocked.
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
vi.mock("@/lib/hooks/skills", () => ({
  useSkill: () => query,
  useUpdateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSkillVersions: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: deleteAsync, isPending: false }),
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
const T = messages.detail.tabs;

beforeEach(() => {
  query = { data: SKILL, isLoading: false, isError: false, refetch: vi.fn() };
  params = new URLSearchParams();
});
afterEach(() => {
  cleanup();
  replace.mockClear();
  push.mockClear();
  deleteAsync.mockReset();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillDetailView />
    </NextIntlClientProvider>,
  );
}

const tabButtons = () => [T.config, T.preview, T.versioning].map((name) => screen.queryByRole("button", { name }));

describe("SkillDetailView — tabs", () => {
  it("shows the header and exactly Config / Preview / Versioning, Config by default", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "breaking-change" })).toBeInTheDocument();
    const header = screen.getByRole("heading", { level: 1 }).parentElement!;
    expect(within(header).getByText("security")).toBeInTheDocument();
    expect(within(header).getByText("v3")).toBeInTheDocument();
    expect(tabButtons().every(Boolean)).toBe(true);
    expect(screen.queryByRole("button", { name: /^Stats|^Evals/ })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: messages.detail.config.title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: messages.detail.back })).toHaveAttribute("href", "/skills");
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
    params = new URLSearchParams("tab=stats");
    renderView();
    expect(screen.getByRole("heading", { level: 2, name: messages.detail.config.title })).toBeInTheDocument();
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
