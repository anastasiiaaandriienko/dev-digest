/**
 * Skill Context tab: attach project context docs to the skill for a chosen
 * repository. Hooks and the repo context are mocked; translations are real.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextAttachment, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/context.json";

const attach = vi.fn();
const detach = vi.fn();
const docsArgs = vi.fn();
const listArgs = vi.fn();
const DOCS: ContextAttachment[] = [{ id: "d1", repo_id: "r2", path: "docs/rules.md", order: 0, status: "ok" }];
vi.mock("@/lib/hooks/context", () => ({
  useContextList: (repoId: string | null, q: string) => {
    listArgs(repoId, q);
    return { data: { files: [{ path: "docs/spec.md", size: 1, updated_at: "x" }], roots: ["docs"], truncated: false, truncated_reasons: [] } };
  },
  useContextDocs: (kind: string, ownerId: string, repoId: string) => {
    docsArgs(kind, ownerId, repoId);
    return { data: repoId === "r2" ? DOCS : [], isError: false };
  },
  useAttachContextDoc: () => ({ mutate: attach, isPending: false }),
  useDetachContextDoc: () => ({ mutate: detach, isPending: false }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "r1",
    repos: [
      { id: "r1", full_name: "acme/api" },
      { id: "r2", full_name: "acme/web" },
    ],
  }),
}));

import { ContextTab } from "./ContextTab";

const SKILL = { id: "s1", name: "breaking-change" } as Skill;

afterEach(() => {
  cleanup();
  attach.mockReset();
  detach.mockReset();
  docsArgs.mockReset();
  listArgs.mockReset();
});

describe("ContextTab", () => {
  it("AC-CTX-55 skill attach for repo", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab skill={SKILL} />
      </NextIntlClientProvider>,
    );
    // Defaults to the active repo.
    expect(docsArgs).toHaveBeenLastCalledWith("skills", "s1", "r1");
    expect(listArgs).toHaveBeenLastCalledWith("r1", "");
    fireEvent.change(screen.getByLabelText(messages.attach.docLabel), { target: { value: "docs/spec.md" } });
    fireEvent.click(screen.getByRole("button", { name: messages.attach.attach }));
    expect(attach.mock.calls[0]![0]).toBe("docs/spec.md");

    // Another repo shows that repo's attachments.
    fireEvent.change(screen.getByLabelText(messages.tab.repoLabel), { target: { value: "r2" } });
    expect(docsArgs).toHaveBeenLastCalledWith("skills", "s1", "r2");
    expect(screen.getByText("docs/rules.md")).toBeInTheDocument();
  });
});
