/**
 * /repos/:repoId/context (project-context-folder): roots, search, list and a
 * read-only preview; Re-index is a list refetch only; the empty state names the
 * roots. Hooks, AppShell and the repo context are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextFile, ContextList, ContextUsage } from "@devdigest/shared";
import { NAV } from "@devdigest/ui";
import messages from "../../../../../../../messages/en/context.json";

type ListQ = { data?: ContextList; isLoading: boolean; isError: boolean; isFetching: boolean; error?: unknown; dataUpdatedAt?: number; refetch: () => void };
let list: ListQ;
let usage: { data?: ContextUsage; isLoading: boolean; isError: boolean };
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
  useContextUsage: () => usage,
  useUpdateContextRoots: () => ({ mutate: saveRoots, isPending: false, error: null }),
}));
vi.mock("../AgentAttachments", () => ({ AgentAttachments: () => <div data-testid="agent-attachments" /> }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repos: [{ id: "r1", name: "payments-api", full_name: "acme/payments-api" }] }),
  useRepoNotFound: () => false,
}));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import * as hooks from "@/lib/hooks/context";
import { ApiError } from "@/lib/api";
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
  usage = { data: undefined, isLoading: true, isError: false };
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
    fireEvent.click(screen.getByRole("button", { name: messages.roots.toggle }));
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
    fireEvent.click(screen.getByRole("button", { name: messages.roots.toggle }));
    fireEvent.change(screen.getByLabelText(messages.roots.label), { target: { value: "docs\n\nspecs, docs" } });
    fireEvent.click(screen.getByRole("button", { name: messages.roots.save }));
    expect(saveRoots).toHaveBeenCalledWith(["docs", "specs"], expect.anything());
  });
});

/** Amendment A2: 3-panel layout, preview header, Download, footer, Roots panel. */
describe("ContextView A2 layout", () => {
  const docsPanel = () => screen.getByRole("region", { name: messages.docsPanelLabel });
  const previewPanel = () => screen.getByRole("region", { name: messages.previewPanelLabel });
  const select = (name = "docs/spec.md") =>
    fireEvent.click(
      within(screen.getByRole("list", { name: messages.listLabel })).getByRole("button", {
        name: new RegExp(name.replace(/[./]/g, "\\$&")),
      }),
    );
  const loadedFile = (content = "# Spec\n\nRule one"): typeof file => ({
    data: { path: "docs/spec.md", content, size: 2048, updated_at: "x", truncated: false },
    isLoading: false,
    isError: false,
  });
  const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("AC-CTX-107 root height calc(100vh - 52px), no maxWidth, docs panel then preview panel", () => {
    renderView();
    const page = docsPanel().parentElement!;
    expect(page.style.height).toBe("calc(100vh - 52px)");
    expect(page.style.maxWidth).toBe("");
    expect(Array.from(page.children)).toEqual([docsPanel(), previewPanel()]);
  });

  it("AC-CTX-108 list and preview body are overflowY auto, minHeight 0", () => {
    renderView();
    const ul = screen.getByRole("list", { name: messages.listLabel });
    expect(ul.style.overflowY).toBe("auto");
    expect(ul.style.minHeight).toMatch(/^0(px)?$/);
    const body = screen.getByTestId("doc-preview").parentElement!;
    expect(body.style.overflowY).toBe("auto");
    expect(body.style.minHeight).toMatch(/^0(px)?$/);
  });

  it("AC-CTX-109 docs panel order", () => {
    renderView();
    const title = screen.getByRole("heading", { name: /Project Context/ });
    const reindex = screen.getByRole("button", { name: messages.reindex });
    const download = screen.getByRole("button", { name: messages.download });
    const search = screen.getByLabelText(messages.searchLabel);
    const list = screen.getByRole("list", { name: messages.listLabel });
    const roots = screen.getByRole("button", { name: messages.roots.toggle });
    const footer = screen.getByText("2 documents");
    const order = [title, reindex, download, search, list, roots, footer];
    for (let i = 0; i < order.length - 1; i++) expect(before(order[i]!, order[i + 1]!)).toBe(true);
    for (const el of order) expect(docsPanel()).toContainElement(el as HTMLElement);
  });

  it("AC-CTX-110 rows: icon, path, kB, aria-pressed on selected only", () => {
    renderView();
    select();
    const rows = within(screen.getByRole("list", { name: messages.listLabel })).getAllByRole("button");
    expect(rows[0]).toHaveAttribute("aria-pressed", "true");
    expect(rows[1]).toHaveAttribute("aria-pressed", "false");
    expect(rows[0]!.querySelector("svg")).not.toBeNull();
    expect(rows[0]).toHaveTextContent("docs/spec.md");
    expect(rows[0]).toHaveTextContent("2 kB");
    expect(rows[1]).toHaveTextContent("0.5 kB");
  });

  it("AC-CTX-111 header outside doc-preview shows the file name and Preview pressed", () => {
    renderView();
    expect(within(previewPanel()).queryByRole("button", { name: messages.preview.modePreview })).toBeNull();
    select("docs/adr/0001.md");
    const preview = screen.getByTestId("doc-preview");
    const pressed = within(previewPanel()).getByRole("button", { name: messages.preview.modePreview });
    expect(pressed).toHaveAttribute("aria-pressed", "true");
    expect(preview).not.toContainElement(pressed);
    const name = within(previewPanel()).getAllByText("0001.md")[0]!;
    expect(preview).not.toContainElement(name);
  });

  it("AC-CTX-112 Edit is disabled with the editDisabled description, sends nothing", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderView();
    select();
    const edit = screen.getByRole("button", { name: messages.preview.modeEdit });
    expect(edit).toBeDisabled();
    expect(edit.parentElement).toHaveAttribute("title", messages.preview.editDisabled);
    expect(edit).toHaveAccessibleDescription(messages.preview.editDisabled);
    fireEvent.click(edit);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveRoots).not.toHaveBeenCalled();
  });

  it("AC-CTX-113 doc-preview has no controls", () => {
    file = loadedFile();
    renderView();
    select();
    const preview = screen.getByTestId("doc-preview");
    expect(within(preview).queryByRole("button")).toBeNull();
    expect(preview.querySelector("input, textarea, [contenteditable='true']")).toBeNull();
    expect(within(preview).getByText(messages.preview.readOnly)).toBeInTheDocument();
  });

  it("AC-CTX-115 Download saves the cached content as spec.md, no fetch", async () => {
    file = loadedFile("# Spec\n\nRule one");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let blob: Blob | undefined;
    let anchor: HTMLAnchorElement | undefined;
    const create = vi.fn((b: Blob) => {
      blob = b;
      return "blob:test";
    });
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      anchor = this;
    });
    try {
      renderView();
      select();
      fireEvent.click(screen.getByRole("button", { name: messages.download }));
      expect(click).toHaveBeenCalledTimes(1);
      expect(anchor?.download).toBe("spec.md");
      expect(blob?.type).toBe("text/markdown;charset=utf-8");
      const text = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsText(blob!);
      });
      expect(text).toBe("# Spec\n\nRule one");
      expect(revoke).toHaveBeenCalledWith("blob:test");
      expect(document.body.querySelector("a[download]")).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  it("AC-CTX-116 Download disabled with no selection, loading or error", () => {
    renderView();
    const download = () => screen.getByRole("button", { name: messages.download });
    expect(download()).toBeDisabled();
    cleanup();
    file = { data: undefined, isLoading: true, isError: false };
    renderView();
    select();
    expect(download()).toBeDisabled();
    cleanup();
    file = { data: undefined, isLoading: false, isError: true };
    renderView();
    select();
    expect(download()).toBeDisabled();
  });

  it("AC-CTX-117 no new/import/save-document controls", () => {
    renderView();
    select();
    expect(screen.queryByRole("button", { name: /new (file|folder)|import|save (doc|file)|upload/i })).toBeNull();
  });

  it("AC-CTX-118 footer: N documents · ~X tokens total, following the listed docs", () => {
    renderView();
    // 2048 + 512 bytes → 512 + 128 tokens (bytes / 4).
    expect(within(docsPanel()).getByText("2 documents")).toBeInTheDocument();
    expect(within(docsPanel()).getByText("~640 tokens total")).toHaveAttribute("title", messages.footer.tokensHint);
    cleanup();
    list = ok({ ...LIST, files: [LIST.files[1]!] });
    renderView();
    expect(within(docsPanel()).getByText("1 document")).toBeInTheDocument();
    expect(within(docsPanel()).getByText("~128 tokens total")).toBeInTheDocument();
    // kB stays on the row only.
    expect(within(docsPanel()).getAllByText("0.5 kB")).toHaveLength(1);
  });

  it("AC-CTX-119 refreshed {time} re-evaluates every 60s", () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date("2026-10-20T12:00:00Z").getTime();
      vi.setSystemTime(t0);
      list = { ...ok(LIST), dataUpdatedAt: t0 - 120_000 };
      renderView();
      expect(screen.getByText("refreshed 2 minutes ago")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(8 * 60_000);
      });
      expect(screen.getByText("refreshed 10 minutes ago")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("AC-CTX-119 Re-index refetches the list and the refreshed time follows the new fetch", () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date("2026-10-20T12:00:00Z").getTime();
      vi.setSystemTime(t0);
      list = { ...ok(LIST), dataUpdatedAt: t0 - 30 * 60_000 };
      renderView();
      expect(screen.getByText("refreshed 30 minutes ago")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: messages.reindex }));
      expect(list.refetch).toHaveBeenCalled();
      // The refetch resolves: React Query moves dataUpdatedAt to now.
      cleanup();
      list = { ...ok(LIST), dataUpdatedAt: t0 };
      renderView();
      expect(screen.getByText("refreshed now")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("AC-CTX-119 no refreshed segment while dataUpdatedAt is 0, the count and tokens stay", () => {
    list = { ...ok(LIST), dataUpdatedAt: 0 };
    renderView();
    expect(screen.queryByText(/^refreshed/)).toBeNull();
    expect(screen.getByText("2 documents")).toBeInTheDocument();
    expect(screen.getByText("~640 tokens total")).toBeInTheDocument();
  });

  it("AC-CTX-121 page opens with Roots collapsed", () => {
    renderView();
    expect(screen.getByRole("button", { name: messages.roots.toggle })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(messages.roots.label)).toBeNull();
    expect(screen.getByRole("group", { name: messages.roots.summary })).toHaveTextContent("docs.devdigest/specs");
  });

  it("AC-CTX-144 states render inside the docs panel", () => {
    list = { data: undefined, isLoading: true, isError: false, isFetching: true, refetch };
    renderView();
    expect(docsPanel().querySelector("[aria-busy='true']")).not.toBeNull();
    cleanup();
    list = {
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      error: new ApiError("x", 409, "REPO_NOT_CLONED"),
      refetch,
    };
    renderView();
    expect(within(docsPanel()).getByRole("alert")).toHaveTextContent(messages.notCloned);
    cleanup();
    list = ok({ ...LIST, files: [] });
    renderView();
    expect(within(docsPanel()).getByText(messages.empty.title)).toBeInTheDocument();
  });

  it("AC-CTX-123 a roots save error keeps the Roots panel expanded", () => {
    vi.spyOn(hooks, "useUpdateContextRoots").mockReturnValue({
      mutate: saveRoots,
      isPending: false,
      error: new Error("boom"),
    } as unknown as ReturnType<typeof hooks.useUpdateContextRoots>);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: messages.roots.toggle }));
    expect(screen.getByRole("button", { name: messages.roots.toggle })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(messages.roots.error);
  });

  it("AC-CTX-145 attach section after and outside doc-preview inside the preview body", () => {
    renderView();
    const preview = screen.getByTestId("doc-preview");
    const attach = screen.getByTestId("agent-attachments");
    expect(preview).not.toContainElement(attach);
    expect(before(preview, attach)).toBe(true);
    expect(previewPanel()).toContainElement(attach);
    expect(attach.parentElement).toBe(preview.parentElement);
    expect(attach.parentElement!.style.overflowY).toBe("auto");
  });
});

/** Amendment A2: "Used by N agents" in the preview header (spec §18.4). */
describe("ContextView A2 usage indicator", () => {
  const select = (path: string) =>
    fireEvent.click(
      within(screen.getByRole("list", { name: messages.listLabel })).getByRole("button", {
        name: new RegExp(path.replace(/[./]/g, "\$&")),
      }),
    );

  it("AC-CTX-124 shows Used by N agents for an exact, case-sensitive path match, else Not used by any agent", () => {
    usage = {
      data: { repo_id: "r1", items: [{ path: "docs/spec.md", agent_count: 3 }, { path: "Docs/adr/0001.md", agent_count: 1 }] },
      isLoading: false,
      isError: false,
    };
    renderView();
    expect(screen.queryByText(/Used by|Not used/)).toBeNull();
    select("docs/spec.md");
    expect(screen.getByText("Used by 3 agents")).toBeInTheDocument();
    select("docs/adr/0001.md");
    expect(screen.getByText("Not used by any agent")).toBeInTheDocument();
    cleanup();
    usage = { data: { repo_id: "r1", items: [{ path: "docs/spec.md", agent_count: 1 }] }, isLoading: false, isError: false };
    renderView();
    select("docs/spec.md");
    expect(screen.getByText("Used by 1 agent")).toBeInTheDocument();
  });

  it("AC-CTX-125 loading or error renders no indicator and the page keeps working", () => {
    for (const state of [
      { data: undefined, isLoading: true, isError: false },
      { data: undefined, isLoading: false, isError: true },
    ]) {
      usage = state;
      renderView();
      select("docs/spec.md");
      expect(screen.queryByText(/Used by|Not used/)).toBeNull();
      expect(screen.getByRole("button", { name: messages.preview.modePreview })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("doc-preview")).toBeInTheDocument();
      cleanup();
    }
  });

  it("AC-CTX-114 Re-index refetches the list only, not usage", () => {
    const usageRefetch = vi.fn();
    usage = { data: { repo_id: "r1", items: [] }, isLoading: false, isError: false, refetch: usageRefetch } as typeof usage;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderView();
    fireEvent.click(screen.getByRole("button", { name: messages.reindex }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(usageRefetch).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
