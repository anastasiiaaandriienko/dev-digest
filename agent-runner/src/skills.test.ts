import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSkillBodies, UNVERSIONED_SKILL } from './skills.js';
import { RunnerError } from './errors.js';

describe('skill loading', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'devdigest-runner-skills-'));
    mkdirSync(path.join(dir, 'skills'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves slugs to PromptSkill objects in manifest order (slug → name, unversioned)', () => {
    writeFileSync(path.join(dir, 'skills', 'secure-config.md'), 'Flag hardcoded credentials.');
    writeFileSync(path.join(dir, 'skills', 'no-todos.md'), 'Flag new TODO comments.');

    expect(loadSkillBodies(dir, ['secure-config', 'no-todos'])).toEqual([
      { name: 'secure-config', version: UNVERSIONED_SKILL, body: 'Flag hardcoded credentials.' },
      { name: 'no-todos', version: UNVERSIONED_SKILL, body: 'Flag new TODO comments.' },
    ]);
    expect(UNVERSIONED_SKILL).toBe(0);
  });

  it('returns an empty list when the manifest has no skills', () => {
    expect(loadSkillBodies(dir, [])).toEqual([]);
  });

  it('throws a RunnerError naming the slug when a skill file is missing', () => {
    expect(() => loadSkillBodies(dir, ['missing-skill'])).toThrow(RunnerError);
    expect(() => loadSkillBodies(dir, ['missing-skill'])).toThrow(/missing-skill/);
  });
});
