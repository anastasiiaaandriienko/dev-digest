import { describe, it, expect } from "vitest";
import type { Conflict, ConflictTake, FindingGroup } from "@devdigest/shared";
import { disagreeRows, isPartial, locationLabel, takeKind } from "./helpers";

/** L07 T11 — row selection only; conflicts and takes come from the server. */

const take = (agent: string, verdict: ConflictTake["verdict"], note = ""): ConflictTake => ({
  agent_id: agent,
  persona: agent,
  verdict,
  note,
});
const conflict = (file: string, start: number, end = start, takes: ConflictTake[] = []): Conflict => ({
  file,
  line: start,
  start_line: start,
  end_line: end,
  title: `${file}:${start}`,
  takes,
});
const group = (file: string, start: number, runIds: string[], end = start): FindingGroup => ({
  file,
  start_line: start,
  end_line: end,
  title: `${file}:${start}`,
  members: runIds.map((run_id, i) => ({
    finding_id: `f-${file}-${start}-${i}`,
    run_id,
    agent_id: `a-${run_id}`,
    agent_name: run_id,
    severity: "WARNING" as const,
    title: "t",
  })),
  takes: [],
});

describe("disagreeRows (AC-MAR-43)", () => {
  const run = {
    conflicts: [conflict("b.ts", 10), conflict("a.ts", 52)],
    groups: [
      group("a.ts", 52, ["r1", "r2"]), // same range as a conflict → listed once
      group("a.ts", 5, ["r1", "r3"]), // agreement by 2 agents
      group("c.ts", 1, ["r1"]), // one agent only → never listed
      group("c.ts", 9, ["r2", "r2"]), // two findings, same agent → one agent
    ],
  };

  it("toggle ON (default): conflicts only, sorted by file then line", () => {
    expect(disagreeRows(run, true).map((r) => [r.file, r.start_line, r.conflict])).toEqual([
      ["a.ts", 52, true],
      ["b.ts", 10, true],
    ]);
  });

  it("toggle OFF: plus groups flagged by ≥2 distinct agents, de-duplicated", () => {
    expect(disagreeRows(run, false).map((r) => [r.file, r.start_line, r.conflict])).toEqual([
      ["a.ts", 5, false],
      ["a.ts", 52, true],
      ["b.ts", 10, true],
    ]);
  });

  it("no conflicts and no shared groups → no rows", () => {
    expect(disagreeRows({ conflicts: [], groups: [group("x.ts", 1, ["r1"])] }, false)).toEqual([]);
    expect(disagreeRows({ conflicts: [], groups: [] }, true)).toEqual([]);
  });

  it("keeps the server takes untouched", () => {
    const takes = [take("A", "CRITICAL", "Hardcoded key"), take("B", "ignored"), take("C", "no_result")];
    expect(disagreeRows({ conflicts: [conflict("a.ts", 1, 1, takes)], groups: [] }, true)[0]!.takes).toBe(takes);
  });
});

describe("takeKind, isPartial, locationLabel", () => {
  it("separates severity, ignored (did not flag) and no_result (no opinion yet)", () => {
    expect(takeKind(take("A", "WARNING"))).toBe("severity");
    expect(takeKind(take("A", "ignored"))).toBe("ignored");
    expect(takeKind(take("A", "no_result"))).toBe("no_result");
  });

  it("partial while any column is running (AC-MAR-44)", () => {
    expect(isPartial([{ status: "done" }, { status: "running" }])).toBe(true);
    expect(isPartial([{ status: "done" }, { status: "failed" }, { status: "cancelled" }])).toBe(false);
  });

  it("labels single lines and ranges", () => {
    expect(locationLabel({ file: "a.ts", start_line: 28, end_line: 28 })).toBe("a.ts:28");
    expect(locationLabel({ file: "a.ts", start_line: 28, end_line: 34 })).toBe("a.ts:28–34");
  });
});
