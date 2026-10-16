import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillImportItem, findExecutableContent } from '@devdigest/shared';
import { parseImportFile } from '../src/modules/skills/import/parse-file.js';

/**
 * HW2 #17 — the Test Quality Reviewer skill in docs/skills/test-quality-reviewer
 * stays importable through the real Skills Import parser and keeps the parts a
 * reviewer skill needs: directive rules for every gap the experiment targets,
 * what not to report, evidence requirements, and GOOD / BAD examples. No DB, no LLM.
 */

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'skills', 'test-quality-reviewer');
const FILE = 'test-quality.md';
const parse = () => parseImportFile(FILE, readFileSync(join(DIR, FILE)));

describe('Test Quality Reviewer skill (HW2 #17)', () => {
  it('the folder holds only this skill (nothing else would be imported from a zip of it)', () => {
    expect(readdirSync(DIR)).toEqual([FILE]);
  });

  it('parses cleanly through the importer as a rubric named test-quality', () => {
    const parsed = parse();
    expect(parsed.format).toBe('md');
    expect(parsed.candidates).toHaveLength(1);
    const [c] = parsed.candidates;
    expect(c).toMatchObject({ name: 'test-quality', type: 'rubric', issues: [] });
    expect(c!.description.length).toBeGreaterThan(40);
    // The same shared rules the import API enforces on the final item.
    expect(SkillImportItem.safeParse({ name: c!.name, description: c!.description, type: c!.type, body: c!.body }).success).toBe(true);
    expect(findExecutableContent(c!.body)).toBeNull();
  });

  it('has the reviewer-skill structure: rules, false-positive guard, evidence, examples, template', () => {
    const body = parse().candidates[0]!.body;
    expect(body).toMatch(/^# Test quality$/m);
    expect(body).toMatch(/^## Report it when the diff does any of these$/m);
    expect(body).toMatch(/^## Do NOT report$/m);
    expect(body).toMatch(/^## Evidence \(required for every finding\)$/m);
    expect(body).toMatch(/^## Examples$/m);
    expect(body).toMatch(/^## Finding template$/m);
    for (const part of ['file + line', 'Affected contract', 'Missing case', 'Impact']) expect(body).toContain(part);
    expect(body).toMatch(/Severity: \*\*WARNING\*\*/); // maps to DevDigest severities
    expect(body).toContain('Category: `test`');
    expect((body.match(/\*\*BAD\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((body.match(/\*\*GOOD\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((body.match(/^```/gm) ?? []).length % 2).toBe(0); // every code fence is closed
    expect(body).toContain('```ts');
  });

  it.each([
    ['happy-path-only tests', /\*\*Happy path only\*\*/],
    ['missing negative cases', /\*\*Missing negative cases\*\*/],
    ['boundary values', /\*\*Missing boundary values\*\*/],
    ['error handling', /\*\*Untested error handling\*\*/],
    ['async rejections', /\*\*Async rejection not tested\*\*/],
    ['weak assertions', /\*\*Weak assertions\*\*/],
    ['mocks hiding behaviour', /\*\*Mocks that hide the behaviour under test\*\*/],
  ])('has a rule for %s', (_label, re) => {
    expect(parse().candidates[0]!.body).toMatch(re);
  });

  it('gives the reviewer no instructions outside its role (no output-format or security overrides)', () => {
    const body = parse().candidates[0]!.body.toLowerCase();
    for (const phrase of ['ignore previous', 'ignore the above', 'system prompt', 'disregard', 'you must output', 'approve the pr']) {
      expect(body).not.toContain(phrase);
    }
  });
});
