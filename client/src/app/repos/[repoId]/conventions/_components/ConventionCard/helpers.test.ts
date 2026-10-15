import { describe, it, expect } from "vitest";
import { evidenceLocation, evidenceUrl, percent } from "./helpers";

describe("ConventionCard helpers", () => {
  it("evidence location and percent", () => {
    expect(evidenceLocation({ evidence_path: "src/a.ts", evidence_line: 12 })).toBe("src/a.ts:12");
    expect(evidenceLocation({ evidence_path: "src/a.ts", evidence_line: null })).toBe("src/a.ts");
    expect(evidenceLocation({ evidence_path: null, evidence_line: null })).toBeNull();
    expect(percent(0.873)).toBe("87%");
    expect(percent(null)).toBe("—");
  });

  it("evidenceUrl: GitHub blob link at the source ref; null without a path or a source", () => {
    const source = { repo_full_name: "acme/api", ref: "c0ffee1" };
    expect(evidenceUrl({ evidence_path: "src/a b.ts", evidence_line: 12 }, source)).toBe("https://github.com/acme/api/blob/c0ffee1/src/a%20b.ts#L12");
    expect(evidenceUrl({ evidence_path: "tsconfig.json", evidence_line: null }, source)).toBe("https://github.com/acme/api/blob/c0ffee1/tsconfig.json");
    expect(evidenceUrl({ evidence_path: null, evidence_line: null }, source)).toBeNull();
    expect(evidenceUrl({ evidence_path: "src/a.ts", evidence_line: 1 }, undefined)).toBeNull();
  });
});
