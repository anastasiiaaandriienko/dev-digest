import { describe, it, expect } from "vitest";
import { NAV, SHORTCUTS } from "./nav";

/** HW2 #6 — sidebar groups: Pull Requests stays in WORKSPACE, Skills + Agents live in SKILLS LAB. */
describe("NAV", () => {
  const section = (name: string) => NAV.find((g) => g.section === name);
  const keys = (name: string) => section(name)?.items.map((i) => i.key);

  it("keeps Pull Requests under WORKSPACE and moves Agents out of it", () => {
    expect(keys("WORKSPACE")).toEqual(["pulls"]);
  });

  it("lists Skills then Agents under SKILLS LAB", () => {
    expect(keys("SKILLS LAB")).toEqual(["skills", "agents"]);
    expect(section("SKILLS LAB")!.items[0]).toMatchObject({ href: "/skills", icon: "Sparkles", gKey: "s" });
    expect(section("SKILLS LAB")!.items[1]).toMatchObject({ href: "/agents", gKey: "a" });
  });

  it("has unique keys and g-shortcuts, each documented in SHORTCUTS", () => {
    const items = NAV.flatMap((g) => g.items);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    const gKeys = items.map((i) => i.gKey).filter(Boolean);
    expect(new Set(gKeys).size).toBe(gKeys.length);
    for (const g of gKeys) expect(SHORTCUTS.some((s) => s.keys === `g ${g}`)).toBe(true);
  });
});
