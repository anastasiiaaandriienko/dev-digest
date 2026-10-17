import { describe, it, expect } from 'vitest';
import { findExecutableContent } from '@devdigest/shared';
import {
  TEST_QUALITY_AGENT_PROMPT,
  TEST_QUALITY_MODEL,
  TEST_QUALITY_PROVIDER,
  TEST_QUALITY_SKILL_NAME,
  loadTestQualitySkill,
} from '../src/db/seed-test-quality.js';

/**
 * HW2 — Test Quality Reviewer setup, hermetic part (no DB, no LLM): the skill
 * the seed links is the importable docs file, and the agent's own prompt does
 * not already carry the rubric (the A/B experiment varies only the skill link).
 */
describe('Test Quality Reviewer seed config', () => {
  it('loads the docs skill through the import parser as rubric `test-quality`', () => {
    const skill = loadTestQualitySkill();
    expect(skill).toMatchObject({ name: TEST_QUALITY_SKILL_NAME, type: 'rubric' });
    expect(skill.body).toMatch(/^# Test quality$/m);
    expect(findExecutableContent(skill.body)).toBeNull();
  });

  it('keeps the system prompt short and free of the skill rules', () => {
    expect(TEST_QUALITY_AGENT_PROMPT.length).toBeLessThan(200);
    for (const phrase of ['happy path', 'boundary', 'negative', 'rejection', 'mock']) {
      expect(TEST_QUALITY_AGENT_PROMPT.toLowerCase()).not.toContain(phrase);
    }
  });

  it('uses the same provider/model as the API Contract A/B run', () => {
    expect(`${TEST_QUALITY_PROVIDER}/${TEST_QUALITY_MODEL}`).toBe('openrouter/deepseek/deepseek-v4-flash');
  });
});
