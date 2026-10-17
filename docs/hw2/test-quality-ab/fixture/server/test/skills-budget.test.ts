import { describe, it, expect, vi } from 'vitest';
import { fitSkillsToBudget, loadSkillBodies } from '../src/modules/skills/budget.js';

describe('skill budget', () => {
  it('keeps enabled skills within the budget', () => {
    const kept = fitSkillsToBudget(
      [
        { id: 'a', tokens: 10, enabled: true },
        { id: 'b', tokens: 5, enabled: false },
      ],
      100,
    );
    expect(kept.map((s) => s.id)).toEqual(['a']);
  });

  it('loads skill bodies', async () => {
    const repo = { getBody: vi.fn().mockResolvedValue('# x') };
    const bodies = await loadSkillBodies(['a'], repo);
    expect(bodies).toBeDefined();
  });
});
