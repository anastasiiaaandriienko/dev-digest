import { describe, it, expect } from "vitest";
import { evidenceLocation, percent } from "./helpers";

describe("ConventionCard helpers", () => {
  it("evidence location and percent", () => {
    expect(evidenceLocation({ evidence_path: "src/a.ts", evidence_line: 12 })).toBe("src/a.ts:12");
    expect(evidenceLocation({ evidence_path: "src/a.ts", evidence_line: null })).toBe("src/a.ts");
    expect(evidenceLocation({ evidence_path: null, evidence_line: null })).toBeNull();
    expect(percent(0.873)).toBe("87%");
    expect(percent(null)).toBe("—");
  });
});
