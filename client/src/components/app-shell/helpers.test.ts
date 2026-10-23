import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";
import { NAV } from "@devdigest/ui";
import shell from "../../../messages/en/shell.json";

/** L07 AC-MAR-48 / export-to-ci §6.3 — the GLOBAL sidebar items are active on their routes. */
describe("activeKeyFor — L07 GLOBAL routes", () => {
  it("is multi-agent on Configure run and on a PR's Results page (checked before /pulls)", () => {
    expect(activeKeyFor("/repos/r1/multi-agent")).toBe("multi-agent");
    expect(activeKeyFor("/repos/r1/pulls/482/multi-agent")).toBe("multi-agent");
  });

  it("keeps the PR pages on pulls", () => {
    expect(activeKeyFor("/repos/r1/pulls")).toBe("pulls");
    expect(activeKeyFor("/repos/r1/pulls/482")).toBe("pulls");
  });

  it("is ci-runs on the CI Runs page; an agent's CI tab stays on agents", () => {
    expect(activeKeyFor("/ci-runs")).toBe("ci-runs");
    expect(activeKeyFor("/agents/a1")).toBe("agents");
  });

  it("every sidebar key has a command-palette label in shell.json", () => {
    const labels = shell.nav as Record<string, string>;
    for (const item of NAV.flatMap((g) => g.items)) expect(labels[item.key]).toBeTruthy();
    expect(labels["multi-agent"]).toBe("Multi-Agent Review");
    expect(labels["ci-runs"]).toBe("CI Runs");
  });
});
