/**
 * /repos/:repoId/context (project-context-folder): roots, search, list and a
 * read-only preview; Re-index is a list refetch only; the empty state names the
 * roots. Hooks, AppShell and the repo context are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextFile, ContextList } from "@devdigest/shared";
import { NAV } from "@devdigest/ui";
import messages from "../../../../../../../messages/en/context.json";

type ListQ = { data?: ContextList; isLoading: boolean; isError: boolean; isFetching: boolean; error?: unknown; refetch: () => void };
let list: ListQ;
let file: { data?: ContextFile; isLoading: boolean; isError: boolean; error?: unknown };
const refetch = vi.fn();
const saveRoots = vi.fn();
const listArgs = vi.fn();
vi.mock("@/lib/hooks/context", () => ({
  useContextRoots: () => ({ data: { roots: ["docs", ".devdigest/specs"] } }),
  useContextList: (repoId: string, q: string) => {
    listArgs(repoId, q);
    return list;
  },
  useContextFile: () => file,
  useUpdateContextRoots: () => ({ mutate: saveRoots, isPending: false, error: null }),
}));
vi.mock("../AgentAttachments", () => ({ AgentAttachments: () => null }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repos: [{ id: "r1", name: "payments-api", full_name: "acme/payments-api" }] }),
  useRepoNotFound: () => false,
}));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ContextView } from "./ContextView";

const LIST: ContextList = {
  files: [
    { path: "docs/spec.md", size: 2048, updated_at: "2026-10-18T10:00:00.000Z" },
    { path: "docs/adr/0001.md", size: 512, updated_at: "2026-10-18T10:00:00.000Z" },
  ],
  roots: ["docs", ".devdigest/specs"],
  truncated: false,
  truncated_reasons: [],
};
const ok = (data: ContextList): ListQ => ({ data, isLoading: false, isError: false, isFetching: false, refetch });

beforeEach(() => {
  list = ok(LIST);
  file = { data: undefined, isLoading: false, isError: false };
});
afterEach(() => {
  cleanup();
  refetch.mockReset();
  saveRoots.mockReset();
  listArgs.mockReset();
  vi.restoreAllMocks();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextView repoId="r1" />
    </NextIntlClientProvider>,
  );
}

describe("ContextView", () => {
  it("AC-CTX-12 roots, search, list, preview render; nav has Project Context", () => {
    file = {
      data: { path: "docs/spec.md", content: "# Spec\n\nRule one", size: 2048, updated_at: "x", truncated: false },
      isLoading: false,
      isError: false,
    };
    renderView();
    expect(screen.getByLabelText(messages.roots.label)).toHaveValue("docs\n.devdigest/specs");
    expect(screen.getByLabelText(messages.searchLabel)).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: messages.listLabel })).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("docs/spec.md"), expect.stringContaining("docs/adr/0001.md")]);
    fireEvent.click(rows[0]!);
    const preview = screen.getByTestId("doc-preview");
    expect(within(preview).getByText("Rule one")).toBeInTheDocument();
    const item = NAV.flatMap((g) => g.items).find((i) => i.key === "context");
    expect(item).toMatchObject({ label: "Project Context", href: "/repos/:repoId/context" });
  });

  it("AC-CTX-52 preview has no editable control or save", () => {
    file = {
      data: { path: "docs/spec.md", content: "# Spec", size: 10, updated_at: "x", truncated: true },
      isLoading: false,
      isError: false,
    };
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: /docs\/spec\.md/ })[0]!);
    const preview = screen.getByTestId("doc-preview");
    expect(within(preview).queryByRole("textbox")).toBeNull();
    expect(within(preview).queryByRole("button")).toBeNull();
    expect(preview.querySelector("input, textarea, [contenteditable='true']")).toBeNull();
    expect(within(preview).getByText(messages.preview.readOnly)).toBeInTheDocument();
    expect(within(preview).getByText(messages.preview.truncated)).toBeInTheDocument();
  });

  it("AC-CTX-53 Re-index sends only the GET list", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderView();
    fireEvent.click(screen.getByRole("button", { name: messages.reindex }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(saveRoots).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("AC-CTX-13 empty state names roots", () => {
    list = ok({ ...LIST, files: [] });
    renderView();
    expect(screen.getByText(messages.empty.title)).toBeInTheDocument();
    expect(screen.getByText(/docs, \.devdigest\/specs/)).toBeInTheDocument();
  });

  it("AC-CTX-13 saving roots sends the parsed list", () => {
    renderView();
    fireEvent.change(screen.getByLabelText(messages.roots.label), { target: { value: "docs\n\nspecs, docs" } });
    fireEvent.click(screen.getByRole("button", { name: messages.roots.save }));
    expect(saveRoots).toHaveBeenCalledWith(["docs", "specs"], expect.anything());
  });
});
