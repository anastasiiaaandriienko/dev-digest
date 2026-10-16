import { describe, it, expect } from 'vitest';
import { PromptAssembly } from '@devdigest/shared';
import { formatSkill, skillsSection } from '@devdigest/reviewer-core';
import { appliedSkillsLine, planSkills } from '../src/modules/reviews/helpers.js';

/**
 * HW2 #14/#19/#20 — the per-run skill plan: what the prompt gets, what the
 * trace records, and the log line. Pure; the DB filter (linked + enabled for
 * the agent + enabled globally, in order) is covered by skills-in-prompt.it.
 */

const len = (text: string) => text.length; // deterministic stand-in for tiktoken
const A = { id: 'a-id', name: 'breaking-change', version: 3, body: '# A\nFlag removals.' };
const B = { id: 'b-id', name: 'semver', version: 1, body: '# B\nMajor bump.' };

describe('planSkills', () => {
  it('keeps the given order for the prompt and the trace, with per-block token counts', () => {
    const plan = planSkills([A, B], len);
    expect(plan.prompt).toEqual([
      { name: 'breaking-change', version: 3, body: '# A\nFlag removals.' },
      { name: 'semver', version: 1, body: '# B\nMajor bump.' },
    ]);
    expect(plan.applied).toEqual([
      { skill_id: 'a-id', name: 'breaking-change', version: 3, order: 0, tokens: formatSkill(plan.prompt[0]!).length },
      { skill_id: 'b-id', name: 'semver', version: 1, order: 1, tokens: formatSkill(plan.prompt[1]!).length },
    ]);
  });

  it('counts the Skills section ONLY (exactly what goes into the system message)', () => {
    const plan = planSkills([A, B], len);
    expect(plan.section).toBe(skillsSection(plan.prompt));
    expect(plan.sectionTokens).toBe(plan.section!.length);
  });

  it('a reorder changes the prompt and the trace order', () => {
    const ba = planSkills([B, A], len);
    expect(ba.applied.map((s) => [s.skill_id, s.order])).toEqual([
      ['b-id', 0],
      ['a-id', 1],
    ]);
    expect(ba.section!.indexOf('# B')).toBeLessThan(ba.section!.indexOf('# A'));
  });

  it('no skills → nothing to send, null tokens', () => {
    expect(planSkills([], len)).toEqual({ prompt: [], applied: [], section: undefined, sectionTokens: null });
  });

  it('the applied list is valid in the trace contract (old traces without it still parse)', () => {
    const plan = planSkills([A], len);
    const base = { system: 's', user: 'u' };
    expect(PromptAssembly.parse({ ...base, skill_blocks: plan.applied, skills_tokens: plan.sectionTokens }).skill_blocks).toHaveLength(1);
    expect(PromptAssembly.parse(base).skill_blocks).toBeUndefined();
  });
});

describe('appliedSkillsLine', () => {
  it('lists the applied skills in order with the section token count', () => {
    expect(appliedSkillsLine(planSkills([A, B], () => 7))).toBe(
      'skills: applied 2 — breaking-change v3 → semver v1 (7 tokens)',
    );
  });

  it('says none when nothing is applied (and never names a skill that is not applied)', () => {
    expect(appliedSkillsLine(planSkills([], len))).toBe('skills: none applied');
  });
});
