import { describe, it, expect } from "vitest";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import {
  appliedCount,
  attach,
  buildRows,
  detach,
  dropOn,
  filterRows,
  itemsFrom,
  moveBy,
  sameItems,
  setEnabled,
} from "./helpers";

const sk = (id: string, o: Partial<Skill> = {}): Skill => ({
  id,
  name: id,
  description: "",
  type: "custom",
  source: "manual",
  body: "# x",
  enabled: true,
  version: 1,
  evidence_files: null,
  agent_count: 0,
  ...o,
});
const link = (skill_id: string, order: number, enabled = true): AgentSkillLink => ({
  agent_id: "ag",
  skill_id,
  order,
  enabled,
});

describe("buildRows", () => {
  const skills = [sk("zeta"), sk("alpha"), sk("beta", { enabled: false }), sk("gamma"), sk("delta")];
  // linked out of array order on purpose: c (order 0), gamma (1, off for agent), beta (2, off globally), zeta (3)
  const links = [link("zeta", 3), link("gamma", 1, false), link("beta", 2), link("delta", 0)];
  const { attached, available } = buildRows(skills, links);

  it("lists attached skills in link (prompt) order, then the rest by name", () => {
    expect(attached.map((r) => r.skill.id)).toEqual(["delta", "gamma", "beta", "zeta"]);
    expect(available.map((r) => r.skill.id)).toEqual(["alpha"]);
  });

  it("applies a skill only when attached, enabled for the agent AND globally; positions count applied ones", () => {
    expect(attached.map((r) => [r.skill.id, r.applied, r.promptOrder])).toEqual([
      ["delta", true, 1],
      ["gamma", false, null], // off for this agent
      ["beta", false, null], // off globally
      ["zeta", true, 2],
    ]);
    expect(attached.find((r) => r.skill.id === "gamma")).toMatchObject({ agentEnabled: false, globalEnabled: true });
    expect(attached.find((r) => r.skill.id === "beta")).toMatchObject({ agentEnabled: true, globalEnabled: false });
    expect(appliedCount(attached)).toBe(2);
    expect(available[0]).toMatchObject({ attached: false, applied: false, promptOrder: null });
  });

  it("drops a link whose skill no longer exists", () => {
    expect(buildRows([sk("a")], [link("a", 0), link("gone", 1)]).attached.map((r) => r.skill.id)).toEqual(["a"]);
  });
});

describe("list operations", () => {
  const items = itemsFrom([link("b", 1, false), link("a", 0), link("c", 2)]);

  it("itemsFrom sorts by order and keeps the per-agent flag", () => {
    expect(items).toEqual([
      { skill_id: "a", enabled: true },
      { skill_id: "b", enabled: false },
      { skill_id: "c", enabled: true },
    ]);
  });

  it("attach appends enabled (last in the prompt); attaching twice is a no-op", () => {
    expect(attach(items, "d").at(-1)).toEqual({ skill_id: "d", enabled: true });
    expect(attach(items, "a")).toEqual(items);
  });

  it("detach removes; setEnabled keeps the position", () => {
    expect(detach(items, "b").map((i) => i.skill_id)).toEqual(["a", "c"]);
    expect(setEnabled(items, "b", true)).toEqual([
      { skill_id: "a", enabled: true },
      { skill_id: "b", enabled: true },
      { skill_id: "c", enabled: true },
    ]);
  });

  it("moveBy moves one step and clamps at the ends", () => {
    expect(moveBy(items, "c", -1).map((i) => i.skill_id)).toEqual(["a", "c", "b"]);
    expect(moveBy(items, "a", -1).map((i) => i.skill_id)).toEqual(["a", "b", "c"]);
    expect(moveBy(items, "c", 1).map((i) => i.skill_id)).toEqual(["a", "b", "c"]);
  });

  it("dropOn puts the dragged item at the target's position (both directions)", () => {
    expect(dropOn(items, "c", "a").map((i) => i.skill_id)).toEqual(["c", "a", "b"]);
    expect(dropOn(items, "a", "c").map((i) => i.skill_id)).toEqual(["b", "c", "a"]);
    expect(dropOn(items, "a", "a")).toEqual(items);
  });

  it("sameItems detects a no-op change", () => {
    expect(sameItems(items, [...items])).toBe(true);
    expect(sameItems(items, setEnabled(items, "a", false))).toBe(false);
    expect(sameItems(items, moveBy(items, "b", 1))).toBe(false);
  });

  it("filterRows matches names case-insensitively", () => {
    const { attached } = buildRows([sk("Breaking-Change"), sk("naming")], [link("Breaking-Change", 0), link("naming", 1)]);
    expect(filterRows(attached, "break").map((r) => r.skill.id)).toEqual(["Breaking-Change"]);
    expect(filterRows(attached, "  ")).toHaveLength(2);
  });
});
