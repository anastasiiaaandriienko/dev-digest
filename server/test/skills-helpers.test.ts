import { describe, it, expect } from 'vitest';
import { Skill, SkillCreate, SkillUpdate } from '@devdigest/shared';
import { bodyChanged, nextVersion, toSkillDto, toUpdateValues } from '../src/modules/skills/helpers.js';
import type { SkillRow } from '../src/db/rows.js';

/**
 * HW2 #8 — skills module pure parts: row → DTO mapping, the "only a changed
 * body creates a version" rule, and the request contracts. The SQL (workspace
 * scope, transactions, agent_count, cascade) is in skills.it.test.ts.
 */

const ROW: SkillRow = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  name: 'breaking-change',
  description: 'Flag breaking API changes',
  type: 'rubric',
  source: 'manual',
  body: '# Rule\nFlag removed fields.',
  enabled: true,
  version: 3,
  evidenceFiles: null,
  createdAt: new Date('2026-10-15T10:00:00.000Z'),
};

describe('toSkillDto', () => {
  it('maps a row to the contract shape with agent_count', () => {
    const dto = toSkillDto(ROW, 2);
    expect(dto).toEqual({
      id: ROW.id,
      name: 'breaking-change',
      description: 'Flag breaking API changes',
      type: 'rubric',
      source: 'manual',
      body: '# Rule\nFlag removed fields.',
      enabled: true,
      version: 3,
      evidence_files: null,
      agent_count: 2,
    });
    expect(Skill.parse(dto)).toEqual(dto);
  });
});

describe('version rule', () => {
  it('a different body bumps the version', () => {
    expect(bodyChanged(ROW, { body: '# New' })).toBe(true);
    expect(nextVersion(ROW, { body: '# New' })).toBe(4);
  });

  it('the same body, or no body, keeps the version', () => {
    expect(bodyChanged(ROW, { body: ROW.body })).toBe(false);
    expect(nextVersion(ROW, { body: ROW.body })).toBe(3);
    expect(nextVersion(ROW, { name: 'renamed', enabled: false })).toBe(3);
  });
});

describe('toUpdateValues', () => {
  it('metadata-only patch: no body / version in the update', () => {
    expect(toUpdateValues(ROW, { name: 'renamed', enabled: false, type: 'security' })).toEqual({
      name: 'renamed',
      enabled: false,
      type: 'security',
    });
  });

  it('body change: body and the next version are written', () => {
    expect(toUpdateValues(ROW, { body: '# New', description: 'd' })).toEqual({
      description: 'd',
      body: '# New',
      version: 4,
    });
  });

  it('unchanged body only: nothing to write', () => {
    expect(toUpdateValues(ROW, { body: ROW.body })).toEqual({});
  });

  it('evidence_files can be cleared with null', () => {
    expect(toUpdateValues(ROW, { evidence_files: null })).toEqual({ evidenceFiles: null });
  });
});

describe('SkillCreate / SkillUpdate contracts', () => {
  it('create: defaults description, source and enabled; trims the name', () => {
    expect(SkillCreate.parse({ name: '  api  ', type: 'custom', body: '# x' })).toEqual({
      name: 'api',
      description: '',
      type: 'custom',
      source: 'manual',
      body: '# x',
      enabled: true,
    });
  });

  it('create: rejects an empty name or body and an unknown type', () => {
    expect(SkillCreate.safeParse({ name: ' ', type: 'custom', body: '# x' }).success).toBe(false);
    expect(SkillCreate.safeParse({ name: 'a', type: 'custom', body: '' }).success).toBe(false);
    expect(SkillCreate.safeParse({ name: 'a', type: 'nope', body: '# x' }).success).toBe(false);
  });

  it('evidence_files is bounded (≤100 paths, ≤500 chars each)', () => {
    const base = { name: 'a', type: 'custom', body: '# x' };
    expect(SkillCreate.safeParse({ ...base, evidence_files: ['src/a.ts'] }).success).toBe(true);
    expect(SkillCreate.safeParse({ ...base, evidence_files: Array(101).fill('a.ts') }).success).toBe(false);
    expect(SkillUpdate.safeParse({ evidence_files: ['x'.repeat(501)] }).success).toBe(false);
  });

  it('update: partial, but not empty', () => {
    expect(SkillUpdate.safeParse({ enabled: false }).success).toBe(true);
    expect(SkillUpdate.safeParse({}).success).toBe(false);
    expect(SkillUpdate.safeParse({ body: '' }).success).toBe(false);
  });
});
