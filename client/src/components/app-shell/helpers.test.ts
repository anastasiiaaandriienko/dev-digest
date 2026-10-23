import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";
import { NAV } from "@devdigest/ui";
import shell from "../../../messages/en/shell.json";

/** L07 AC-MAR-48 — the Multi-Agent Review sidebar item is active on its routes. */
describe("activeKeyFor — multi-agent routes", () => {
  it("is multi-agent on Configure run and on a PR's Results page (checked before /pulls)", () => {
    expect(activeKeyFor("/repos/r1/multi-agent")).toBe("multi-agent");
    expect(activeKeyFor("/repos/r1/pulls/482/multi-agent")).toBe("multi-agent");
  });

  it("keeps the PR pages on pulls", () => {
    expect(activeKeyFor("/repos/r1/pulls")).toBe("pulls");
    expect(activeKeyFor("/repos/r1/pulls/482")).toBe("pulls");
  });

  it("every sidebar key has a command-palette label in shell.json", () => {
    const labels = shell.nav as Record<string, string>;
    for (const item of NAV.flatMap((g) => g.items)) expect(labels[item.key]).toBeTruthy();
    expect(labels["multi-agent"]).toBe("Multi-Agent Review");
  });
});
