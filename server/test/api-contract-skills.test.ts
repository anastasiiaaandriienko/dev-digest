import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { SkillImportItem, findExecutableContent } from '@devdigest/shared';
import { parseImportFile } from '../src/modules/skills/import/parse-file.js';

/**
 * HW2 #43 — the four API Contract Reviewer skills in docs/skills/api-contract-reviewer
 * stay importable through the real Skills Import parser (one .md at a time and
 * as one .zip), keep their names / types, and keep the parts a reviewer skill
 * needs: directive rules, what not to report, evidence requirements, and
 * GOOD / BAD examples. No DB, no LLM.
 */

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'skills', 'api-contract-reviewer');
const EXPECTED = {
  'breaking-change': 'rubric',
  'response-schema': 'rubric',
  'semver-discipline': 'convention',
  'deprecation-policy': 'convention',
} as const;
const read = (name: string) => readFileSync(join(DIR, `${name}.md`));

describe('API Contract Reviewer skills (HW2 #43)', () => {
  it('the folder holds exactly the four skills (nothing else would be imported from a zip of it)', () => {
    expect(readdirSync(DIR).sort()).toEqual(Object.keys(EXPECTED).map((n) => `${n}.md`).sort());
  });

  it.each(Object.entries(EXPECTED))('%s parses cleanly through the importer with its name and type', (name, type) => {
    const parsed = parseImportFile(`${name}.md`, read(name));
    expect(parsed.format).toBe('md');
    expect(parsed.candidates).toHaveLength(1);
    const [c] = parsed.candidates;
    expect(c).toMatchObject({ name, type, issues: [] });
    expect(c!.description.length).toBeGreaterThan(40);
    // The same shared rules the import API enforces on the final item.
    expect(SkillImportItem.safeParse({ name: c!.name, description: c!.description, type: c!.type, body: c!.body }).success).toBe(true);
    expect(findExecutableContent(c!.body)).toBeNull();
  });

  it.each(Object.keys(EXPECTED))('%s is a directive reviewer skill with GOOD / BAD examples and evidence rules', (name) => {
    const body = parseImportFile(`${name}.md`, read(name)).candidates[0]!.body;
    expect(body).toMatch(/^# /m);
    expect(body).toMatch(/^## (Report it when|Rules)/m); // what to flag
    expect(body).toMatch(/^## Do NOT report/m); // false-positive guard
    expect(body).toMatch(/^## Evidence \(required for every finding\)/m);
    for (const part of ['file + line', 'Affected contract', 'Impact']) expect(body).toContain(part);
    expect(body).toMatch(/\*\*BAD\b/);
    expect(body).toMatch(/\*\*GOOD\b/);
    expect(body).toMatch(/Severity: \*\*CRITICAL\*\*/); // maps to DevDigest severities
    expect((body.match(/^```/gm) ?? []).length % 2).toBe(0); // every code fence is closed
    expect(body).toContain('```ts');
  });

  it('all four import together from one .zip', () => {
    const zip = zipSync(Object.fromEntries(Object.keys(EXPECTED).map((n) => [`api-contract-reviewer/${n}.md`, strToU8(read(n).toString('utf8'))])));
    const parsed = parseImportFile('api-contract-reviewer.zip', zip);
    expect(parsed.candidates.map((c) => [c.name, c.type, c.issues.length])).toEqual(
      Object.entries(EXPECTED)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([n, ty]) => [n, ty, 0]),
    );
  });
});
