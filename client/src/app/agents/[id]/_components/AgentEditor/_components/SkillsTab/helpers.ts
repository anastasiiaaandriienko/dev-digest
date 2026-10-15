import type { AgentSkillLink, Skill } from "@devdigest/shared";
import type { AgentSkillItem } from "@/lib/hooks/agents";

/**
 * Pure model of the agent's Skills tab. Three switches never mix:
 *  - attached       — a row in agent_skills (its position = prompt order);
 *  - agentEnabled   — agent_skills.enabled (this agent only);
 *  - globalEnabled  — skills.enabled (every agent).
 * A skill is APPLIED to the prompt only when all three hold.
 */
export interface SkillRow {
  skill: Skill;
  attached: boolean;
  agentEnabled: boolean;
  globalEnabled: boolean;
  /** True when the review prompt will include it. */
  applied: boolean;
  /** 1-based position in the prompt among applied skills; null when not applied. */
  promptOrder: number | null;
}

/** Attached rows in link order (= prompt order), then the rest by name. */
export function buildRows(
  skills: readonly Skill[],
  links: readonly AgentSkillLink[],
): { attached: SkillRow[]; available: SkillRow[] } {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const linked = [...links].sort((a, b) => a.order - b.order);
  let position = 0;
  const attached: SkillRow[] = [];
  for (const link of linked) {
    const skill = byId.get(link.skill_id);
    if (!skill) continue; // deleted meanwhile; the next refetch drops the link
    const applied = link.enabled && skill.enabled;
    attached.push({
      skill,
      attached: true,
      agentEnabled: link.enabled,
      globalEnabled: skill.enabled,
      applied,
      promptOrder: applied ? ++position : null,
    });
  }
  const linkedIds = new Set(linked.map((l) => l.skill_id));
  const available = skills
    .filter((s) => !linkedIds.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({
      skill,
      attached: false,
      agentEnabled: false,
      globalEnabled: skill.enabled,
      applied: false,
      promptOrder: null,
    }));
  return { attached, available };
}

/** Number of skills the prompt will include. */
export function appliedCount(rows: readonly SkillRow[]): number {
  return rows.filter((r) => r.applied).length;
}

/** The PUT body for the current links, in order. */
export function itemsFrom(links: readonly AgentSkillLink[]): AgentSkillItem[] {
  return [...links].sort((a, b) => a.order - b.order).map((l) => ({ skill_id: l.skill_id, enabled: l.enabled }));
}

/** Attach at the end (last in the prompt), enabled. No-op if already attached. */
export function attach(items: readonly AgentSkillItem[], skillId: string): AgentSkillItem[] {
  if (items.some((i) => i.skill_id === skillId)) return [...items];
  return [...items, { skill_id: skillId, enabled: true }];
}

export function detach(items: readonly AgentSkillItem[], skillId: string): AgentSkillItem[] {
  return items.filter((i) => i.skill_id !== skillId);
}

/** Per-agent switch; the skill keeps its position. */
export function setEnabled(items: readonly AgentSkillItem[], skillId: string, enabled: boolean): AgentSkillItem[] {
  return items.map((i) => (i.skill_id === skillId ? { ...i, enabled } : i));
}

/** Move one item by `delta` positions (keyboard ↑ / ↓); clamped to the list. */
export function moveBy(items: readonly AgentSkillItem[], skillId: string, delta: number): AgentSkillItem[] {
  const from = items.findIndex((i) => i.skill_id === skillId);
  if (from < 0) return [...items];
  const to = Math.max(0, Math.min(items.length - 1, from + delta));
  return moveTo(items, from, to);
}

/** Drag & drop: put the dragged item where the target is. */
export function dropOn(items: readonly AgentSkillItem[], draggedId: string, targetId: string): AgentSkillItem[] {
  const from = items.findIndex((i) => i.skill_id === draggedId);
  const to = items.findIndex((i) => i.skill_id === targetId);
  if (from < 0 || to < 0 || from === to) return [...items];
  return moveTo(items, from, to);
}

function moveTo(items: readonly AgentSkillItem[], from: number, to: number): AgentSkillItem[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Same order? (skip a PUT that would change nothing) */
export function sameItems(a: readonly AgentSkillItem[], b: readonly AgentSkillItem[]): boolean {
  return a.length === b.length && a.every((x, i) => x.skill_id === b[i]!.skill_id && x.enabled === b[i]!.enabled);
}

/** Case-insensitive name filter; a blank query keeps all. */
export function filterRows(rows: readonly SkillRow[], query: string): SkillRow[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.skill.name.toLowerCase().includes(q)) : [...rows];
}
