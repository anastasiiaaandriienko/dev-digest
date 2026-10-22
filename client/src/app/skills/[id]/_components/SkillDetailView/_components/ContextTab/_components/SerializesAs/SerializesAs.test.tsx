/**
 * SerializesAs — the skill's docs as the review prompt holds them: the
 * `## Project context` section with the server's group headings, in order.
 */
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextAttachment, ContextListItem } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/context.json";
import { SerializesAs } from "./SerializesAs";
import { serializedGroups } from "./helpers";

const att = (path: string, order: number, status: ContextAttachment["status"] = "ok"): ContextAttachment => ({
  id: path,
  repo_id: "r1",
  path,
  order,
  status,
});
const file = (path: string, size: number): ContextListItem => ({ path, size, updated_at: "x" });
const ROOTS = ["specs", "docs", "insights", "notes"];
const FILES = [file("docs/b.md", 800), file("specs/a.md", 4000), file("insights/i.md", 100_000), file("notes/n.md", 40)];

afterEach(cleanup);

function renderBlock(attachments: ContextAttachment[]) {
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <SerializesAs attachments={attachments} files={FILES} roots={ROOTS} />
    </NextIntlClientProvider>,
  );
}

describe("serializedGroups", () => {
  it("groups ok attachments by root in the server's heading order, keeping attachment order inside a group", () => {
    const { groups, skipped } = serializedGroups(
      [att("docs/b.md", 0), att("notes/n.md", 1), att("specs/a.md", 2), att("docs/gone.md", 3, "missing"), att("docs/x.md", 4)],
      FILES,
      ROOTS,
    );
    expect(groups).toEqual([
      { title: "Project specifications", docs: [{ path: "specs/a.md", tokens: 1000 }] },
      {
        title: "Project docs",
        docs: [
          { path: "docs/b.md", tokens: 200 },
          { path: "docs/x.md", tokens: null },
        ],
      },
      { title: "Other project docs", docs: [{ path: "notes/n.md", tokens: 10 }] },
    ]);
    expect(skipped).toBe(1);
  });

  it("sorts by order before grouping", () => {
    const { groups } = serializedGroups([att("docs/z.md", 2), att("docs/b.md", 0)], FILES, ROOTS);
    expect(groups[0]!.docs.map((d) => d.path)).toEqual(["docs/b.md", "docs/z.md"]);
  });
});

describe("SerializesAs", () => {
  it("renders the section, the headings and each doc with its approximate tokens", () => {
    renderBlock([att("docs/b.md", 0), att("specs/a.md", 1), att("insights/i.md", 2)]);
    expect(screen.getByText("Serializes as")).toBeInTheDocument();
    expect(screen.getByText("## Project context")).toBeInTheDocument();
    const headings = screen.getAllByText(/^### /).map((h) => h.textContent);
    expect(headings).toEqual(["### Project specifications", "### Project docs", "### Project insights"]);
    expect(within(screen.getByRole("list", { name: "Project specifications" })).getByText("~1,000 tokens")).toBeInTheDocument();
    // 100 kB is capped like the server's injection (L4/L5).
    expect(within(screen.getByRole("list", { name: "Project insights" })).getByText("~4,000 tokens")).toBeInTheDocument();
    expect(screen.queryByText(/missing or outside the roots/)).toBeNull();
    expect(screen.getByText(messages.serializes.hint)).toBeInTheDocument();
  });

  it("says nothing is added when no doc would be read, and counts skipped attachments", () => {
    renderBlock([att("docs/gone.md", 0, "missing"), att("docs/out.md", 1, "outside_roots")]);
    expect(screen.getByText(messages.serializes.empty)).toBeInTheDocument();
    expect(screen.queryByText("## Project context")).toBeNull();
    expect(screen.getByText("2 attached docs are missing or outside the roots and will be skipped.")).toBeInTheDocument();
  });
});
