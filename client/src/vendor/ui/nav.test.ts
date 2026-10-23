import { describe, it, expect } from "vitest";
import { NAV, SHORTCUTS, resolveHref } from "./nav";

/**
 * HW2 #6, #44 — sidebar groups: the repo pages (Pull Requests, Project Context) live in
 * WORKSPACE; Skills, Agents, Conventions live in SKILLS LAB.
 */
describe("NAV", () => {
  const section = (name: string) => NAV.find((g) => g.section === name);
  const keys = (name: string) => section(name)?.items.map((i) => i.key);

  it("lists Pull Requests, then Project Context under WORKSPACE", () => {
    expect(keys("WORKSPACE")).toEqual(["pulls", "context"]);
    expect(section("WORKSPACE")!.items[1]).toMatchObject({
      label: "Project Context",
      icon: "FileText",
      href: "/repos/:repoId/context",
    });
  });

  it("lists Skills, Agents, Conventions, Eval Dashboard under SKILLS LAB", () => {
    expect(keys("SKILLS LAB")).toEqual(["skills", "agents", "conventions", "eval"]);
    expect(section("SKILLS LAB")!.items[3]).toEqual({ key: "eval", label: "Eval Dashboard", icon: "Gauge", href: "/eval" });
    expect(section("SKILLS LAB")!.items[2]).toMatchObject({
      label: "Conventions",
      icon: "ListChecks",
      href: "/repos/:repoId/conventions",
      gKey: "c",
    });
    expect(section("SKILLS LAB")!.items[0]).toMatchObject({ href: "/skills", icon: "Sparkles", gKey: "s" });
    expect(section("SKILLS LAB")!.items[1]).toMatchObject({ href: "/agents", gKey: "a" });
  });

  it("L07 AC-MAR-48 / export-to-ci §6.3: a GLOBAL section after SKILLS LAB holds Multi-Agent Review, then CI Runs", () => {
    expect(NAV.map((g) => g.section)).toEqual(["WORKSPACE", "SKILLS LAB", "GLOBAL"]);
    expect(section("GLOBAL")!.items).toEqual([
      { key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/repos/:repoId/multi-agent" },
      { key: "ci-runs", label: "CI Runs", icon: "Workflow", href: "/ci-runs" },
    ]);
  });

  it("CI Runs is workspace-wide: its href does not depend on the active repo", () => {
    const item = (key: string) => section("GLOBAL")!.items.find((i) => i.key === key)!;
    expect(resolveHref(item("ci-runs").href, "r1")).toBe("/ci-runs");
    expect(resolveHref(item("ci-runs").href, null)).toBe("/ci-runs");
    expect(resolveHref(item("multi-agent").href, "r1")).toBe("/repos/r1/multi-agent");
  });

  it("has unique keys and g-shortcuts, each documented in SHORTCUTS", () => {
    const items = NAV.flatMap((g) => g.items);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    const gKeys = items.map((i) => i.gKey).filter(Boolean);
    expect(new Set(gKeys).size).toBe(gKeys.length);
    for (const g of gKeys) expect(SHORTCUTS.some((s) => s.keys === `g ${g}`)).toBe(true);
  });
});
