import { describe, it, expect } from 'vitest';
import { SkillCreate, SkillImportItem, SkillUpdate, findExecutableContent } from '@devdigest/shared';

/**
 * Skill contracts (security review before the HW2 PR):
 * - a client can only create MANUAL skills (imported / extracted / community
 *   are set by the server's own import and conventions paths);
 * - manual create and update run the same executable-content check as imports;
 * - the executable-content patterns stay linear on hostile input (no ReDoS).
 */
const base = { name: 'my-rule', type: 'rubric' as const, body: '# Rule\nFlag removed fields.' };

describe('SkillCreate', () => {
  it('defaults to a manual skill and refuses any other source', () => {
    expect(SkillCreate.parse(base)).toMatchObject({ source: 'manual', enabled: true, description: '' });
    expect(SkillCreate.parse({ ...base, source: 'manual' }).source).toBe('manual');
    for (const source of ['imported', 'imported_url', 'extracted', 'community']) {
      expect(SkillCreate.safeParse({ ...base, source }).success).toBe(false);
    }
  });

  it('refuses executable content in body or description, but allows it inside code', () => {
    expect(SkillCreate.safeParse({ ...base, body: '# Rule\n<script>alert(1)</script>' }).success).toBe(false);
    expect(SkillCreate.safeParse({ ...base, description: '<img src=x onerror=alert(1)>' }).success).toBe(false);
    expect(SkillCreate.safeParse({ ...base, body: '# Rule\nNever ship `<script>` tags.\n\n```html\n<script>x()</script>\n```' }).success).toBe(true);
  });

  it('refuses bidi / control characters ("Trojan Source")', () => {
    expect(SkillCreate.safeParse({ ...base, body: '# Rule\nsafe\u202Etext' }).success).toBe(false);
  });
});

describe('SkillUpdate', () => {
  it('runs the same checks on a changed body or description', () => {
    expect(SkillUpdate.safeParse({ body: '<iframe src="x"></iframe>' }).success).toBe(false);
    expect(SkillUpdate.safeParse({ description: 'javascript:alert(1)' }).success).toBe(false);
    expect(SkillUpdate.safeParse({ body: '# New rule\n- plain text' }).success).toBe(true);
    expect(SkillUpdate.safeParse({ enabled: false }).success).toBe(true);
  });
});

describe('executable-content patterns are linear on hostile input', () => {
  it('a long run of "<a" with no ">" is scanned quickly', () => {
    const hostile = '<a '.repeat(60_000); // ~180 KB, under the body limit
    const started = performance.now();
    expect(findExecutableContent(hostile)).toBeNull();
    expect(SkillImportItem.safeParse({ name: 'x', type: 'rubric', body: hostile }).success).toBe(true);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('still finds a handler / meta refresh inside a normal-sized tag', () => {
    expect(findExecutableContent('<div class="a" onclick="x()">')).toMatch(/event handler/);
    expect(findExecutableContent('<meta charset="utf-8" http-equiv="refresh" content="0">')).toMatch(/meta/);
  });

  it('over-length input fails on the length rule without being scanned', () => {
    const tooLong = '<a '.repeat(70_000); // > 200 000 characters
    const res = SkillCreate.safeParse({ ...base, body: tooLong });
    expect(res.success).toBe(false);
    expect(res.error!.issues.every((i) => i.code === 'too_big')).toBe(true);
  });
});
