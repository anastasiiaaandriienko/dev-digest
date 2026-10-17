import { NotFoundError } from '../../platform/errors.js';

/** A skill as the prompt budgeter sees it. */
export interface BudgetSkill {
  id: string;
  tokens: number;
  enabled: boolean;
}

/**
 * Keep enabled skills, in order, while they fit into `budget` tokens. A skill
 * that does not fit is skipped; later, smaller skills may still fit.
 */
export function fitSkillsToBudget(skills: readonly BudgetSkill[], budget: number): BudgetSkill[] {
  if (!Number.isInteger(budget) || budget <= 0) throw new RangeError('budget must be a positive integer');
  const kept: BudgetSkill[] = [];
  let used = 0;
  for (const s of skills) {
    if (!s.enabled) continue;
    if (used + s.tokens > budget) continue;
    kept.push(s);
    used += s.tokens;
  }
  return kept;
}

/** Load the body of every skill id, in order; a missing skill is an error. */
export async function loadSkillBodies(
  ids: readonly string[],
  repo: { getBody(id: string): Promise<string | undefined> },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of ids) {
    const body = await repo.getBody(id);
    if (body === undefined) throw new NotFoundError(`Skill ${id} not found`);
    out.set(id, body);
  }
  return out;
}
