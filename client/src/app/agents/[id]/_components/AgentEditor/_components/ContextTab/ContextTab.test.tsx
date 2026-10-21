/**
 * Agent editor Context tab (CTX amendment A1): list, attach/detach, preview,
 * filter, repo picker and degraded states. Hooks and the repo context are
 * mocked; translations are real.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, ContextAttachment, ContextList } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../../../messages/en/context.json";

const attach = vi.fn();
const detach = vi.fn();
const reorder = vi.fn();
let reorderPending = false;
const docsArgs = vi.fn();
const listArgs = vi.fn();
const fileArgs = vi.fn();
let list: { data?: ContextList; isLoading: boolean; isError: boolean; error?: unknown; refetch: () => void };
let docs: Record<string, ContextAttachment[]>;
let repos: { id: string; full_name: string }[];

vi.mock("@/lib/hooks/context", () => ({
  useContextList: (repoId: string | null, q: string) => {
    listArgs(repoId, q);
    return list;
  },
  useContextDocs: (kind: string, ownerId: string, repoId: string) => {
    docsArgs(kind, ownerId, repoId);
    return { data: docs[repoId] ?? [], isError: false };
  },
  useContextFile: (repoId: string, path: string | null) => {
    fileArgs(repoId, path);
    return { data: path ? { path, content: "# Preview body", truncated: false } : undefined, isLoading: false, isError: false };
  },
  useAttachContextDoc: () => ({ mutate: attach, isPending: false }),
  useDetachContextDoc: () => ({ mutate: detach, isPending: false }),
  useReorderContextDocs: () => ({ mutate: reorder, isPending: reorderPending, isError: false }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1", repos }),
}));

import { ContextTab } from "./ContextTab";

const AGENT = { id: "ag1", name: "Reviewer" } as Agent;
const LIST: ContextList = {
  files: [
    { path: "docs/spec.md", size: 2048, updated_at: "x" },
    { path: "docs/adr/0001.md", size: 512, updated_at: "x" },
    { path: ".devdigest/specs/api.md", size: 30 * 1024, updated_at: "x" },
    { path: "notes/misc.md", size: 100, updated_at: "x" },
  ],
  roots: ["docs", ".devdigest/specs", "notes"],
  truncated: false,
  truncated_reasons: [],
};
const att = (id: string, path: string, order: number, status: ContextAttachment["status"] = "ok"): ContextAttachment => ({
  id,
  repo_id: "r1",
  path,
  order,
  status,
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}
const rowOf = (path: string) => document.querySelector(`li[data-path="${path}"]`) as HTMLElement;
const checkbox = (path: string) => within(rowOf(path)).getByRole("checkbox") as HTMLInputElement;
const paths = () => Array.from(document.querySelectorAll("li[data-path]")).map((li) => li.getAttribute("data-path"));

beforeEach(() => {
  list = { data: LIST, isLoading: false, isError: false, refetch: vi.fn() };
  docs = { r1: [], r2: [att("x1", "docs/rules.md", 1)] };
  repos = [
    { id: "r1", full_name: "acme/api" },
    { id: "r2", full_name: "acme/web" },
  ];
});
afterEach(() => {
  cleanup();
  attach.mockReset();
  detach.mockReset();
  reorder.mockReset();
  reorderPending = false;
  docsArgs.mockReset();
  listArgs.mockReset();
  fileArgs.mockReset();
});

describe("Agent ContextTab", () => {
  it("AC-CTX-82 lists every discovered doc with filename, folder and longest-root badge", () => {
    renderTab();
    expect(listArgs).toHaveBeenLastCalledWith("r1", "");
    expect(paths()).toHaveLength(4);
    const row = rowOf("docs/adr/0001.md");
    expect(within(row).getByText("0001.md")).toBeInTheDocument();
    expect(within(row).getByText("docs/adr")).toBeInTheDocument();
    expect(within(row).getByText("docs")).toBeInTheDocument();
    expect(within(rowOf(".devdigest/specs/api.md")).getAllByText(".devdigest/specs")).toHaveLength(2); // folder + root badge
  });

  it("AC-CTX-83 shows attachments first (checked, server order), then the rest unchecked", () => {
    docs.r1 = [att("a1", "notes/misc.md", 1), att("a2", "docs/spec.md", 2)];
    renderTab();
    expect(paths()).toEqual(["notes/misc.md", "docs/spec.md", "docs/adr/0001.md", ".devdigest/specs/api.md"]);
    expect(checkbox("notes/misc.md").checked).toBe(true);
    expect(checkbox("docs/spec.md").checked).toBe(true);
    expect(checkbox("docs/adr/0001.md").checked).toBe(false);
  });

  it("AC-CTX-84 badge reads 'a of d attached'", () => {
    docs.r1 = [att("a1", "docs/spec.md", 1), att("a2", "notes/misc.md", 2)];
    renderTab();
    expect(screen.getByText("2 of 4 attached")).toBeInTheDocument();
  });

  it("AC-CTX-85 checking an unattached doc sends one attach with its path", () => {
    renderTab();
    fireEvent.click(checkbox("docs/spec.md"));
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]![0]).toBe("docs/spec.md");
    expect(detach).not.toHaveBeenCalled();
  });

  it("AC-CTX-86 unchecking an attached doc sends one detach with the row id", () => {
    docs.r1 = [att("a1", "docs/spec.md", 1)];
    renderTab();
    fireEvent.click(checkbox("docs/spec.md"));
    expect(detach).toHaveBeenCalledTimes(1);
    expect(detach.mock.calls[0]![0]).toBe("a1");
    expect(attach).not.toHaveBeenCalled();
  });

  it("AC-CTX-87 at 10 attachments the unchecked boxes are disabled and the limit message shows", () => {
    const many = Array.from({ length: 10 }, (_, i) => att(`a${i}`, `docs/gen-${i}.md`, i + 1));
    docs.r1 = many;
    list = { ...list, data: { ...LIST, files: [...many.map((a) => ({ path: a.path, size: 1, updated_at: "x" })), ...LIST.files] } };
    renderTab();
    expect(screen.getByText(messages.attach.limit)).toBeInTheDocument();
    expect(checkbox("docs/spec.md").disabled).toBe(true);
    expect(checkbox("docs/gen-0.md").disabled).toBe(false);
  });

  it("AC-CTX-88 missing and outside_roots attachments stay listed with a status and can be unchecked", () => {
    docs.r1 = [att("m1", "gone/old.md", 1, "missing"), att("o1", "elsewhere/x.md", 2, "outside_roots")];
    renderTab();
    expect(within(rowOf("gone/old.md")).getByText(messages.attach.status.missing)).toBeInTheDocument();
    expect(within(rowOf("elsewhere/x.md")).getByText(messages.attach.status.outside_roots)).toBeInTheDocument();
    fireEvent.click(checkbox("gone/old.md"));
    expect(detach.mock.calls[0]![0]).toBe("m1");
  });

  it("AC-CTX-89 Preview shows the read-only DocPreview for that path", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Preview docs/spec.md" }));
    expect(fileArgs).toHaveBeenLastCalledWith("r1", "docs/spec.md");
    const panel = screen.getByTestId("doc-preview");
    expect(within(panel).getByText("Read-only preview")).toBeInTheDocument();
    expect(within(panel).queryByRole("textbox")).toBeNull();
    expect(within(panel).queryByRole("button")).toBeNull();
  });

  it("AC-CTX-90 filter narrows rows by path, case-insensitively, without a new request", () => {
    renderTab();
    fireEvent.change(screen.getByLabelText(messages.agentTab.filterLabel), { target: { value: "ADR" } });
    expect(paths()).toEqual(["docs/adr/0001.md"]);
    expect(listArgs.mock.calls.every((c) => c[1] === "")).toBe(true);
  });

  it("AC-CTX-91 shows the order helper text and the untrusted-injection footer", () => {
    renderTab();
    expect(screen.getByText(messages.agentTab.helper)).toBeInTheDocument();
    expect(screen.getByText(messages.agentTab.footer)).toBeInTheDocument();
  });

  it("AC-CTX-92 picker defaults to the active repo and switching repo switches list and attachments", () => {
    renderTab();
    expect(docsArgs).toHaveBeenLastCalledWith("agents", "ag1", "r1");
    expect(screen.getByLabelText(messages.tab.repoLabel)).toHaveValue("r1");
    fireEvent.change(screen.getByLabelText(messages.tab.repoLabel), { target: { value: "r2" } });
    expect(listArgs).toHaveBeenLastCalledWith("r2", "");
    expect(docsArgs).toHaveBeenLastCalledWith("agents", "ag1", "r2");
    expect(rowOf("docs/rules.md")).toBeTruthy();
  });

  it("AC-CTX-93 no repo shows the noRepo message and no list", () => {
    repos = [];
    renderTab();
    expect(screen.getByText(messages.tab.noRepo)).toBeInTheDocument();
    expect(paths()).toHaveLength(0);
  });

  it("AC-CTX-94 not cloned shows notCloned, no checkbox, and still lists attachments with status", () => {
    list = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("not cloned", 409, "REPO_NOT_CLONED"),
      refetch: vi.fn(),
    };
    docs.r1 = [att("a1", "docs/spec.md", 1, "missing")];
    renderTab();
    expect(screen.getByText(messages.notCloned)).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(rowOf("docs/spec.md")).getByText(messages.attach.status.missing)).toBeInTheDocument();
  });

  it("AC-CTX-105 rows show size in kB, no per-row token counts; no total while nothing is attached", () => {
    renderTab();
    expect(within(rowOf("docs/spec.md")).getByText("2 kB")).toBeInTheDocument();
    expect(within(rowOf("docs/adr/0001.md")).getByText("0.5 kB")).toBeInTheDocument();
    expect(within(rowOf(".devdigest/specs/api.md")).getByText("30 kB")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/token/i);
  });

  it("shows the approximate prompt tokens of the attached docs, capped per doc, without a warning under the budget", () => {
    docs = {
      r1: [
        att("a1", "docs/spec.md", 0), // 2 kB → 512
        att("a2", ".devdigest/specs/api.md", 1), // 30 kB → 7,680, capped at 4,000
        att("a3", "docs/gone.md", 2, "missing"), // skipped at review time → not counted
      ],
    };
    renderTab();
    const total = screen.getByText("~4,512 tokens");
    expect(total).toHaveAttribute("title", messages.agentTab.tokensHint);
    expect(screen.queryByRole("alert")).toBeNull();
    for (const p of ["docs/spec.md", ".devdigest/specs/api.md"]) expect(rowOf(p).textContent).not.toMatch(/token/i);
  });

  it("warns when the attached docs exceed the Project context token budget", () => {
    const big = Array.from({ length: 4 }, (_, i) => ({ path: `docs/big${i}.md`, size: 20_000, updated_at: "x" }));
    list = { ...list, data: { ...LIST, files: [...LIST.files, ...big] } };
    docs = { r1: big.map((f, i) => att(`b${i}`, f.path, i)) };
    renderTab();
    expect(screen.getByText("~16,000 tokens")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The attached docs are about 16,000 tokens, over the 12,000-token Project context budget.",
    );
  });

  it("AC-CTX-96 reorder controls are disabled while filtering or pending", () => {
    docs.r1 = [att("a1", "docs/spec.md", 1), att("a2", "notes/misc.md", 2)];
    const view = renderTab();
    const down = () => within(rowOf("docs/spec.md")).getByRole("button", { name: "Move docs/spec.md down" }) as HTMLButtonElement;
    expect(down().disabled).toBe(false);
    expect(rowOf("docs/spec.md").getAttribute("draggable")).toBe("true");
    // Not attached rows have no reorder controls.
    expect(within(rowOf("docs/adr/0001.md")).queryByRole("button", { name: /Move/ })).toBeNull();

    fireEvent.change(screen.getByLabelText(messages.agentTab.filterLabel), { target: { value: "docs" } });
    expect(down().disabled).toBe(true);
    expect(rowOf("docs/spec.md").getAttribute("draggable")).toBe("false");

    fireEvent.change(screen.getByLabelText(messages.agentTab.filterLabel), { target: { value: "" } });
    expect(down().disabled).toBe(false);
    reorderPending = true;
    view.rerender(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab agent={AGENT} />
      </NextIntlClientProvider>,
    );
    expect(down().disabled).toBe(true);
    expect(rowOf("docs/spec.md").getAttribute("draggable")).toBe("false");
  });

  it("AC-CTX-94 not-cloned: attached rows keep reorder controls", () => {
    list = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("not cloned", 409, "REPO_NOT_CLONED"),
      refetch: vi.fn(),
    };
    docs.r1 = [att("a1", "docs/spec.md", 1, "missing"), att("a2", "notes/misc.md", 2)];
    renderTab();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(within(rowOf("docs/spec.md")).getByRole("button", { name: "Move docs/spec.md down" }));
    expect(reorder).toHaveBeenCalledWith(["a2", "a1"]);
    expect((within(rowOf("docs/spec.md")).getByRole("button", { name: "Move docs/spec.md up" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
