/**
 * Agent attachments on the Project Context page: attach a discovered doc for
 * this repo, list what is attached, flag missing / outside-roots docs, detach.
 * Hooks are mocked; translations are the real ones.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextAttachment, ContextListItem } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/context.json";

let docs: { data?: ContextAttachment[]; isError: boolean };
const attach = vi.fn();
const detach = vi.fn();
const docsArgs = vi.fn();
vi.mock("@/lib/hooks/context", () => ({
  useContextDocs: (kind: string, ownerId: string, repoId: string) => {
    docsArgs(kind, ownerId, repoId);
    return docs;
  },
  useAttachContextDoc: () => ({ mutate: attach, isPending: false }),
  useDetachContextDoc: () => ({ mutate: detach, isPending: false }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [{ id: "a1", name: "security-agent" }, { id: "a2", name: "style-agent" }] }),
}));

import { AgentAttachments } from "./AgentAttachments";

const FILES: ContextListItem[] = [
  { path: "docs/spec.md", size: 100, updated_at: "2026-10-18T10:00:00.000Z" },
  { path: "docs/adr.md", size: 100, updated_at: "2026-10-18T10:00:00.000Z" },
];
const att = (id: string, path: string, status: ContextAttachment["status"]): ContextAttachment => ({
  id,
  repo_id: "r1",
  path,
  order: 0,
  status,
});

afterEach(() => {
  cleanup();
  attach.mockReset();
  detach.mockReset();
  docsArgs.mockReset();
});

function renderIt() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <AgentAttachments repoId="r1" files={FILES} />
    </NextIntlClientProvider>,
  );
}

describe("AgentAttachments", () => {
  it("AC-CTX-14 attach posts and lists", () => {
    docs = { data: [att("d1", "docs/adr.md", "ok")], isError: false };
    renderIt();
    expect(docsArgs).toHaveBeenCalledWith("agents", "a1", "r1");
    const list = screen.getByRole("list", { name: messages.attach.listLabel });
    expect(within(list).getByText("docs/adr.md")).toBeInTheDocument();
    // An attached doc is not offered again.
    const picker = screen.getByLabelText(messages.attach.docLabel);
    expect(within(picker).queryByRole("option", { name: "docs/adr.md" })).toBeNull();
    expect(screen.getByRole("button", { name: messages.attach.attach })).toBeDisabled();
    fireEvent.change(picker, { target: { value: "docs/spec.md" } });
    fireEvent.click(screen.getByRole("button", { name: messages.attach.attach }));
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]![0]).toBe("docs/spec.md");
    fireEvent.click(screen.getByRole("button", { name: "Detach docs/adr.md" }));
    expect(detach).toHaveBeenCalledWith("d1");
  });

  it("AC-CTX-14 attachments follow the selected agent", () => {
    docs = { data: [], isError: false };
    renderIt();
    fireEvent.change(screen.getByLabelText(messages.attach.agentLabel), { target: { value: "a2" } });
    expect(docsArgs).toHaveBeenLastCalledWith("agents", "a2", "r1");
    expect(screen.getByText(messages.attach.none)).toBeInTheDocument();
  });

  it("AC-CTX-43 missing/outside_roots badges", () => {
    docs = {
      data: [att("d1", "docs/gone.md", "missing"), att("d2", "old/x.md", "outside_roots"), att("d3", "docs/spec.md", "ok")],
      isError: false,
    };
    renderIt();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]!).getByText(messages.attach.status.missing)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(messages.attach.status.outside_roots)).toBeInTheDocument();
    expect(within(rows[2]!).getByText(messages.attach.status.ok)).toBeInTheDocument();
    expect(rows[0]!.querySelector("[data-status='missing']")).toHaveAttribute("title", messages.attach.statusHint.missing);
  });
});
