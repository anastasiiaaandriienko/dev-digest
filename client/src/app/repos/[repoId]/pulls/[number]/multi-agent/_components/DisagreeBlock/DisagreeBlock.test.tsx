import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, Conflict, ConflictTake, FindingGroup } from "@devdigest/shared";
import multiAgent from "../../../../../../../../../messages/en/multiAgent.json";
import { DisagreeBlock } from "./DisagreeBlock";

/** L07 T11 — "Where agents disagree" (AC-MAR-42..44, 54). Pure props, no hooks. */

const take = (persona: string, verdict: ConflictTake["verdict"], note = ""): ConflictTake => ({
  agent_id: `id-${persona}`,
  persona,
  verdict,
  note,
});
const conflict = (file: string, start: number, title: string, takes: ConflictTake[], end = start): Conflict => ({
  file,
  line: start,
  start_line: start,
  end_line: end,
  title,
  takes,
});
const status = (...s: AgentColumn["status"][]) => s.map((x) => ({ status: x }));

function renderBlock(run: { conflicts: Conflict[]; groups: FindingGroup[] }, columns = status("done", "done", "done")) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent }}>
      <DisagreeBlock run={run} columns={columns} />
    </NextIntlClientProvider>
  );
}
const rows = () => screen.queryAllByTestId("disagree-row");
const cellOf = (row: HTMLElement, persona: string) => within(row).getByText(persona).parentElement!;

afterEach(cleanup);

describe("DisagreeBlock", () => {
  it("renders the heading and the 'Show only conflicts' toggle, on by default", () => {
    renderBlock({ conflicts: [], groups: [] });
    expect(screen.getByRole("heading", { name: "WHERE AGENTS DISAGREE" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show only conflicts" })).toHaveAttribute("aria-checked", "true");
  });

  it("different severities: each agent's own severity and finding title", () => {
    renderBlock({
      conflicts: [
        conflict("src/rate.ts", 52, "429 response shape", [
          take("Customer-Facing", "WARNING", "Missing Retry-After"),
          take("Security", "CRITICAL", "Leaks internal error"),
          take("Performance", "SUGGESTION", "Cache the body"),
        ]),
      ],
      groups: [],
    });
    const [row] = rows();
    expect(within(row!).getByText("src/rate.ts:52")).toBeInTheDocument();
    expect(within(row!).getByText("429 response shape")).toBeInTheDocument();
    expect(cellOf(row!, "Security")).toHaveAttribute("data-take", "severity");
    expect(within(cellOf(row!, "Security")).getByText("Leaks internal error")).toBeInTheDocument();
    expect(within(cellOf(row!, "Customer-Facing")).getByText("Missing Retry-After")).toBeInTheDocument();
    expect(within(cellOf(row!, "Performance")).getByText("Cache the body")).toBeInTheDocument();
  });

  it("found vs ignored: 'did not flag' with no reason text (AC-MAR-54)", () => {
    renderBlock({
      conflicts: [conflict("src/rate.ts", 28, "Magic number 3600", [take("Junior Mentor", "SUGGESTION", "Extract it"), take("Security", "ignored")])],
      groups: [],
    });
    const [row] = rows();
    const ignored = cellOf(row!, "Security");
    expect(ignored).toHaveAttribute("data-take", "ignored");
    expect(ignored).toHaveTextContent(/^Securitydid not flag$/);
    expect(within(ignored).queryByText("no result")).not.toBeInTheDocument();
  });

  it("no_result is shown as 'no result' and is never confused with 'did not flag'", () => {
    renderBlock(
      {
        conflicts: [
          conflict("a.ts", 1, "Something", [take("Done", "WARNING", "Found it"), take("Quiet", "ignored"), take("Busy", "no_result")]),
        ],
        groups: [],
      },
      status("done", "done", "running")
    );
    const [row] = rows();
    expect(cellOf(row!, "Busy")).toHaveAttribute("data-take", "no_result");
    expect(within(cellOf(row!, "Busy")).getByText("no result")).toBeInTheDocument();
    expect(within(cellOf(row!, "Busy")).queryByText("did not flag")).not.toBeInTheDocument();
    expect(within(cellOf(row!, "Quiet")).getByText("did not flag")).toBeInTheDocument();
  });

  it("several conflicts are each listed with their own location (range shown as a–b)", () => {
    renderBlock({
      conflicts: [
        conflict("src/rate.ts", 28, "Magic number", [take("A", "SUGGESTION"), take("B", "ignored")]),
        conflict("src/rate.ts", 52, "429 shape", [take("A", "WARNING"), take("B", "CRITICAL")], 60),
      ],
      groups: [],
    });
    expect(rows()).toHaveLength(2);
    expect(within(rows()[1]!).getByText("src/rate.ts:52–60")).toBeInTheDocument();
  });

  it("no conflicts → 'No disagreements between agents.'", () => {
    renderBlock({ conflicts: [], groups: [] });
    expect(screen.getByText(multiAgent.disagree.none)).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
  });

  it("partial multi-run: says it is not final while an agent runs (AC-MAR-44); gone when all finished", () => {
    const run = { conflicts: [conflict("a.ts", 1, "x", [take("A", "WARNING"), take("B", "no_result")])], groups: [] };
    const { unmount } = renderBlock(run, status("done", "running"));
    expect(screen.getByRole("status")).toHaveTextContent(multiAgent.disagree.partial);
    unmount();
    renderBlock(run, status("done", "failed"));
    expect(screen.queryByText(multiAgent.disagree.partial)).not.toBeInTheDocument();
  });

  it("toggle OFF also lists groups flagged by ≥2 agents (agreement), ON hides them again (AC-MAR-43)", () => {
    const agreed: FindingGroup = {
      file: "src/db.ts",
      start_line: 7,
      end_line: 7,
      title: "N+1 query",
      members: [
        { finding_id: "f1", run_id: "r1", agent_id: "a1", agent_name: "A", severity: "WARNING", title: "N+1 query" },
        { finding_id: "f2", run_id: "r2", agent_id: "a2", agent_name: "B", severity: "WARNING", title: "N+1" },
      ],
      takes: [take("A", "WARNING", "N+1 query"), take("B", "WARNING", "N+1")],
    };
    renderBlock({ conflicts: [conflict("src/a.ts", 3, "Conflict", [take("A", "WARNING"), take("B", "ignored")])], groups: [agreed] });
    expect(rows()).toHaveLength(1);
    fireEvent.click(screen.getByRole("switch", { name: "Show only conflicts" }));
    expect(rows()).toHaveLength(2);
    expect(within(rows()[1]!).getByText("src/db.ts:7")).toBeInTheDocument();
    expect(rows()[1]).toHaveAttribute("data-conflict", "false");
    fireEvent.click(screen.getByRole("switch", { name: "Show only conflicts" }));
    expect(rows()).toHaveLength(1);
  });
});
