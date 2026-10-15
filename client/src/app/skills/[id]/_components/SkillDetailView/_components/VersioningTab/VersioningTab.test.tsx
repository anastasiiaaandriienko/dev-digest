import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

type VQ = { data?: SkillVersion[]; isLoading: boolean; isError: boolean; refetch: () => void };
let versionsQuery: VQ;
const restoreAsync = vi.fn();
let restoreState: { isPending: boolean; variables?: { version: number } } = { isPending: false };
vi.mock("@/lib/hooks/skills", () => ({
  useSkillVersions: () => versionsQuery,
  useRestoreSkillVersion: () => ({ mutateAsync: restoreAsync, ...restoreState }),
}));
const success = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => success(m), error: vi.fn(), info: vi.fn() } }));

import { VersioningTab } from "./VersioningTab";

const V = messages.detail.versioning;
const version = (n: number, body: string, current = false): SkillVersion => ({
  skill_id: "s1",
  version: n,
  body,
  created_at: `2026-10-1${n}T10:00:00.000Z`,
  current,
});
// v4 restored v1's body (so v4 and v1 match); v3 is current.
const VERSIONS = [version(4, "# Rule\nkeep\nold line", true), version(3, "# Rule\nkeep\nnew line"), version(2, "# Rule"), version(1, "# Rule\nkeep\nold line")];
const SKILL = { id: "s1", name: "breaking-change", body: "# Rule\nkeep\nold line", version: 4 } as Skill;

beforeEach(() => {
  versionsQuery = { data: VERSIONS, isLoading: false, isError: false, refetch: vi.fn() };
  restoreState = { isPending: false };
});
afterEach(() => {
  cleanup();
  restoreAsync.mockReset();
  success.mockReset();
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <VersioningTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

const row = (n: number) => document.querySelector(`[data-version="${n}"]`) as HTMLElement;

describe("VersioningTab — history", () => {
  it("lists every version newest first with timestamp, count and the Current badge", () => {
    renderTab();
    const items = Array.from(document.querySelectorAll("[data-version]")).map((el) => el.getAttribute("data-version"));
    expect(items).toEqual(["4", "3", "2", "1"]);
    expect(screen.getByText("4 versions")).toBeInTheDocument();
    expect(within(row(4)).getByText(V.current)).toBeInTheDocument();
    expect(within(row(3)).queryByText(V.current)).not.toBeInTheDocument();
    expect(row(2).querySelector("time")).toHaveAttribute("dateTime", "2026-10-12T10:00:00.000Z");
    // the current version has no Diff / Restore
    expect(within(row(4)).queryByRole("button")).toBeNull();
  });

  it("marks a version whose body repeats an older one (a restore)", () => {
    renderTab();
    expect(within(row(4)).getByText("same body as v1")).toBeInTheDocument();
  });

  it("loading, error and empty states", () => {
    versionsQuery = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    const { unmount } = renderTab();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    unmount();
    versionsQuery = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
    const r2 = renderTab();
    expect(screen.getByText(V.loadError)).toBeInTheDocument();
    r2.unmount();
    versionsQuery = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    renderTab();
    expect(screen.getByText(V.empty)).toBeInTheDocument();
  });
});

describe("VersioningTab — diff", () => {
  it("Diff shows the lines removed and added between that version and the current one", () => {
    renderTab();
    fireEvent.click(within(row(3)).getByRole("button", { name: V.diff }));
    const diff = within(row(3)).getByTestId("version-diff");
    expect(diff).toHaveTextContent("v3 → v4 (current)");
    expect(within(diff).getByTestId("version-diff-stats")).toHaveTextContent("+1 −1");
    const kinds = Array.from(diff.querySelectorAll("[data-diff-kind]")).map(
      (el) => `${el.getAttribute("data-diff-kind")}:${el.textContent?.replace(/^\d+/, "").trim()}`,
    );
    expect(kinds).toEqual(["ctx:# Rule", "ctx:keep", "del:−new line", "add:+old line"]);
    // toggles closed
    fireEvent.click(within(row(3)).getByRole("button", { name: V.hideDiff }));
    expect(within(row(3)).queryByTestId("version-diff")).toBeNull();
  });

  it("a version with the current body says there are no differences", () => {
    renderTab();
    fireEvent.click(within(row(1)).getByRole("button", { name: V.diff }));
    expect(within(row(1)).getByText(messages.detail.diff.identical)).toBeInTheDocument();
  });
});

describe("VersioningTab — restore", () => {
  it("Restore posts that version and reports the new version", async () => {
    restoreAsync.mockResolvedValue({ skill: { ...SKILL, version: 5 }, restored: true, restored_from: 3 });
    renderTab();
    fireEvent.click(within(row(3)).getByRole("button", { name: V.restore }));
    await waitFor(() => expect(success).toHaveBeenCalledWith("Restored v3 as v5."));
    expect(restoreAsync).toHaveBeenCalledTimes(1);
    expect(restoreAsync).toHaveBeenCalledWith({ id: "s1", version: 3 });
  });

  it("an old version whose body is already current cannot be restored", () => {
    renderTab();
    const btn = within(row(1)).getByRole("button", { name: V.restore });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", V.restoreSame);
  });

  it("a server no-op is reported as already current", async () => {
    restoreAsync.mockResolvedValue({ skill: SKILL, restored: false, restored_from: 2 });
    renderTab();
    fireEvent.click(within(row(2)).getByRole("button", { name: V.restore }));
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("v2 already matches the current body — nothing to restore."),
    );
  });

  it("while restoring, every Restore is disabled and the clicked one says so", () => {
    restoreState = { isPending: true, variables: { version: 3 } };
    renderTab();
    expect(within(row(3)).getByRole("button", { name: V.restoring })).toBeDisabled();
    expect(within(row(2)).getByRole("button", { name: V.restore })).toBeDisabled();
  });
});
