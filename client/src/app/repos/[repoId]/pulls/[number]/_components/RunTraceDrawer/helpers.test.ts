import { describe, it, expect } from "vitest";
import { droppedFromLog, findingsFromLog, groundingTone, isFindingLogLine } from "./helpers";

// Message shapes as emitted by reviewer-core/src/review/run.ts and the executor.
const LOG = [
  { m: "Starting review with agent \"Sec\" (openai/gpt-4.1)" },
  { m: "src/a.ts: 2 candidate finding(s)" },
  { m: "src/b.ts: 1 candidate finding(s)" },
  { m: "Reduced to 3 finding(s); verdict=request_changes, score=40" },
  { m: 'grounding dropped "Phantom on line 999": line 999 is not in the diff' },
  { m: 'grounding dropped "Quote "inside" title": file not in diff: x.ts' },
  { m: "Citation grounding: 1/3 passed" },
  { m: "Persisted review abc with 1 finding(s)" },
];

describe("droppedFromLog", () => {
  it("parses title and reason of every dropped finding", () => {
    expect(droppedFromLog(LOG)).toEqual([
      { title: "Phantom on line 999", reason: "line 999 is not in the diff" },
      { title: 'Quote "inside" title', reason: "file not in diff: x.ts" },
    ]);
    expect(droppedFromLog([])).toEqual([]);
  });
});

describe("findingsFromLog", () => {
  it("sums candidates over chunks and reads the reduce count", () => {
    const s = findingsFromLog(LOG);
    expect(s.candidates).toBe(3);
    expect(s.reduced).toBe(3);
    expect(s.dropped).toHaveLength(2);
  });

  it("returns null counts (not 0) before the engine reported anything", () => {
    expect(findingsFromLog([{ m: "Loading PR diff…" }])).toEqual({ candidates: null, reduced: null, dropped: [] });
  });
});

describe("isFindingLogLine", () => {
  it("matches finding lines only", () => {
    expect(LOG.filter((l) => isFindingLogLine(l.m))).toHaveLength(7);
    expect(isFindingLogLine("Loading PR diff…")).toBe(false);
  });
});

describe("groundingTone", () => {
  it.each([
    ["3/3 passed", false, "ok"],
    ["1/3 passed", false, "warn"],
    ["0/0 passed", false, "muted"],
    ["3/3 passed", true, "muted"],
    ["garbage", false, "muted"],
  ] as const)("%s (failed=%s) → %s", (g, failed, tone) => {
    expect(groundingTone(g, failed)).toBe(tone);
  });
});
