/**
 * Agent editor Context tab <-> server truth (CTX amendment A1). REAL QueryClient
 * and REAL context hooks; only the HTTP layer (`api.get/post/del`) is mocked by a
 * small in-memory "server". Covers the shared `contextDocsKey` cache between the
 * agent tab and the Context-page AgentAttachments.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, ContextAttachment, ContextList } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import messages from "../../../../../../../../messages/en/context.json";
import { ToastProvider } from "../../../../../../../lib/toast";

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
const put = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (p: string) => get(p),
      post: (p: string, b: unknown) => post(p, b),
      del: (p: string) => del(p),
      put: (p: string, b: unknown) => put(p, b),
    },
  };
});
vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
  useAgentSkills: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useSetAgentSkills: () => ({ mutate: vi.fn(), isPending: false }),
  useAgents: () => ({ data: [{ id: "ag1", name: "Security Reviewer" }] }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1", repos: [{ id: "r1", name: "api", full_name: "acme/api" }] }),
}));

import { AgentEditor } from "../../AgentEditor";
import { AgentAttachments } from "@/app/repos/[repoId]/context/_components/AgentAttachments";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "d",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};
const FILES: ContextList["files"] = [
  { path: "docs/spec.md", size: 2048, updated_at: "x" },
  { path: "docs/adr/0001.md", size: 512, updated_at: "x" },
  { path: "notes/misc.md", size: 100, updated_at: "x" },
];
const LIST: ContextList = { files: FILES, roots: ["docs", "notes"], truncated: false, truncated_reasons: [] };
const att = (id: string, path: string, order: number): ContextAttachment => ({
  id,
  repo_id: "r1",
  path,
  order,
  status: "ok",
});

const DOCS_URL = "/agents/ag1/context-docs?repo_id=r1";
let server: ContextAttachment[];

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function tree(qc: QueryClient, extra?: React.ReactNode) {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, context: messages }}>
        <ToastProvider>
          <AgentEditor agent={AGENT} tab="context" onTab={() => {}} />
          {extra}
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
const paths = () => Array.from(document.querySelectorAll("li[data-path]")).map((li) => li.getAttribute("data-path"));
const checkbox = (path: string) =>
  within(document.querySelector(`li[data-path="${path}"]`) as HTMLElement).getByRole("checkbox") as HTMLInputElement;

beforeEach(() => {
  server = [att("a1", "docs/spec.md", 1)];
  get.mockImplementation(async (p: string) => {
    if (p === DOCS_URL) return server.map((x) => ({ ...x }));
    if (p === "/repos/r1/context") return LIST;
    throw new Error(`unexpected GET ${p}`);
  });
  post.mockImplementation(async (p: string, b: { path: string }) => {
    if (p !== DOCS_URL) throw new Error(`unexpected POST ${p}`);
    const row = att(`n${server.length + 1}`, b.path, server.length + 1);
    server.push(row);
    return row;
  });
  del.mockImplementation(async (p: string) => {
    const id = p.split("/").pop();
    server = server.filter((x) => x.id !== id);
    return { ok: true };
  });
});
afterEach(() => {
  cleanup();
  get.mockReset();
  post.mockReset();
  del.mockReset();
  put.mockReset();
});

describe("Agent ContextTab server truth", () => {
  it("AC-CTX-85 checking sends one POST with {path}; the doc appears at the end of the attached block", async () => {
    render(tree(newClient()));
    await waitFor(() => expect(checkbox("docs/spec.md").checked).toBe(true));
    expect(paths()).toEqual(["docs/spec.md", "docs/adr/0001.md", "notes/misc.md"]);

    fireEvent.click(checkbox("notes/misc.md"));

    await waitFor(() => expect(checkbox("notes/misc.md").checked).toBe(true));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(DOCS_URL, { path: "notes/misc.md" });
    expect(del).not.toHaveBeenCalled();
    expect(paths()).toEqual(["docs/spec.md", "notes/misc.md", "docs/adr/0001.md"]);
  });

  it("AC-CTX-86 unchecking sends one DELETE for that row", async () => {
    server = [att("a1", "docs/spec.md", 1), att("a2", "notes/misc.md", 2)];
    render(tree(newClient()));
    await waitFor(() => expect(checkbox("notes/misc.md").checked).toBe(true));

    fireEvent.click(checkbox("docs/spec.md"));

    await waitFor(() => expect(checkbox("docs/spec.md").checked).toBe(false));
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith("/agents/ag1/context-docs/a1");
    expect(post).not.toHaveBeenCalled();
    expect(checkbox("notes/misc.md").checked).toBe(true);
    expect(paths()[0]).toBe("notes/misc.md");
  });

  it("AC-CTX-102 a remount with a fresh client shows the server order of GET context-docs", async () => {
    server = [att("a1", "docs/spec.md", 1), att("a2", "notes/misc.md", 2)];
    const first = render(tree(newClient()));
    await waitFor(() => expect(paths()).toEqual(["docs/spec.md", "notes/misc.md", "docs/adr/0001.md"]));
    first.unmount();

    // The server order changed meanwhile (e.g. reordered elsewhere).
    server = [att("a2", "notes/misc.md", 1), att("a1", "docs/spec.md", 2)];
    render(tree(newClient()));

    await waitFor(() => expect(paths()).toEqual(["notes/misc.md", "docs/spec.md", "docs/adr/0001.md"]));
    expect(checkbox("notes/misc.md").checked).toBe(true);
    expect(checkbox("docs/adr/0001.md").checked).toBe(false);
  });

  it("AC-CTX-104 attach on the Context page shows in the agent tab without reload", async () => {
    server = [];
    render(tree(newClient(), <AgentAttachments repoId="r1" files={FILES} />));
    await waitFor(() => expect(paths()).toHaveLength(3));
    expect(checkbox("docs/adr/0001.md").checked).toBe(false);

    fireEvent.change(screen.getByLabelText(messages.attach.docLabel), { target: { value: "docs/adr/0001.md" } });
    fireEvent.click(screen.getByRole("button", { name: messages.attach.attach }));

    await waitFor(() => expect(checkbox("docs/adr/0001.md").checked).toBe(true));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(DOCS_URL, { path: "docs/adr/0001.md" });
    expect(paths()[0]).toBe("docs/adr/0001.md");
    // No reload: the docs list was fetched by invalidation, the repo list stayed cached.
    expect(get.mock.calls.filter(([p]) => p === "/repos/r1/context")).toHaveLength(1);
  });

  describe("reorder", () => {
    const ORDER_URL = "/agents/ag1/context-docs/order?repo_id=r1";
    const reorderOk = () =>
      put.mockImplementation(async (p: string, b: { ids: string[] }) => {
        if (p !== ORDER_URL) throw new Error(`unexpected PUT ${p}`);
        server = b.ids.map((id, i) => ({ ...server.find((x) => x.id === id)!, order: i + 1 }));
        return server.map((x) => ({ ...x }));
      });

    it("AC-CTX-95 ↑/↓ and drop send one PUT with all ids in the new order", async () => {
      server = [att("a1", "docs/spec.md", 1), att("a2", "notes/misc.md", 2), att("a3", "docs/adr/0001.md", 3)];
      reorderOk();
      render(tree(newClient()));
      await waitFor(() => expect(paths()).toEqual(["docs/spec.md", "notes/misc.md", "docs/adr/0001.md"]));
      const row = (p: string) => document.querySelector(`li[data-path="${p}"]`) as HTMLElement;

      fireEvent.click(within(row("docs/adr/0001.md")).getByRole("button", { name: "Move docs/adr/0001.md up" }));
      await waitFor(() => expect(paths()).toEqual(["docs/spec.md", "docs/adr/0001.md", "notes/misc.md"]));
      expect(put).toHaveBeenCalledTimes(1);
      expect(put).toHaveBeenLastCalledWith(ORDER_URL, { ids: ["a1", "a3", "a2"] });

      const dt = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: "", dropEffect: "" });
      fireEvent.dragStart(row("docs/spec.md"), { dataTransfer: dt() });
      // Drop handlers are attached only after the dragId re-render.
      await waitFor(() => expect(row("docs/spec.md").getAttribute("style")).toContain("opacity"));
      fireEvent.dragOver(row("notes/misc.md"), { dataTransfer: dt() });
      fireEvent.drop(row("notes/misc.md"), { dataTransfer: dt() });
      await waitFor(() => expect(paths()).toEqual(["docs/adr/0001.md", "notes/misc.md", "docs/spec.md"]));
      expect(put).toHaveBeenCalledTimes(2);
      expect(put).toHaveBeenLastCalledWith(ORDER_URL, { ids: ["a3", "a2", "a1"] });
    });

    it("AC-CTX-97 failed reorder refetches the server order and shows an error", async () => {
      server = [att("a1", "docs/spec.md", 1), att("a2", "notes/misc.md", 2)];
      put.mockRejectedValue(new Error("boom"));
      render(tree(newClient()));
      await waitFor(() => expect(paths()).toEqual(["docs/spec.md", "notes/misc.md", "docs/adr/0001.md"]));
      const docsGets = () => get.mock.calls.filter(([p]) => p === DOCS_URL).length;
      const before = docsGets();

      fireEvent.click(screen.getByRole("button", { name: "Move docs/spec.md down" }));

      expect(await screen.findByText(messages.agentTab.reorderError)).toBeInTheDocument();
      await waitFor(() => expect(docsGets()).toBeGreaterThan(before));
      expect(paths()).toEqual(["docs/spec.md", "notes/misc.md", "docs/adr/0001.md"]);
    });
  });
});
