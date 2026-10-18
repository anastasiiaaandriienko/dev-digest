import { describe, it, expect } from 'vitest';
import {
  isUnderRoots,
  normalizeContextPath,
  planRootsUpsert,
  queryValid,
  rootsKey,
  validateRoots,
} from '../src/modules/context/helpers.js';
import { MAX_QUERY_LENGTH, MAX_ROOTS } from '../src/modules/context/constants.js';

describe('context helpers', () => {
  it('AC-CTX-57 normalizes, case-sensitive', () => {
    const ok = (s: string) => {
      const r = normalizeContextPath(s);
      return r.ok ? r.path : `ERR:${r.reason}`;
    };
    expect(ok('./docs//a.md')).toBe('docs/a.md');
    expect(ok('docs/./a.md')).toBe('docs/a.md');
    expect(ok('docs/sub/')).toBe('docs/sub');
    expect(ok('Docs/a.md')).toBe('Docs/a.md');
    expect(ok('Docs/a.md')).not.toBe(ok('docs/a.md'));
    expect(rootsKey('r1')).toBe('context_roots:r1');
  });

  it.each([
    ['/etc/passwd', 'absolute'],
    ['C:/x/a.md', 'drive'],
    ['c:a.md', 'drive'],
    ['docs/../secret.md', '..'],
    ['..', '..'],
    ['docs\\a.md', 'backslash'],
    ['docs/a\u0000.md', 'control'],
    ['docs/a\n.md', 'control'],
    ['', 'empty'],
    ['./', 'empty'],
  ])('AC-CTX-04/76 rejects absolute/drive/../\\/control: %j (%s)', (input) => {
    expect(normalizeContextPath(input).ok).toBe(false);
  });

  it('AC-CTX-49 rejects 11 roots', () => {
    const eleven = Array.from({ length: MAX_ROOTS + 1 }, (_, i) => `d${i}`);
    expect(validateRoots(eleven).ok).toBe(false);
    const ten = eleven.slice(0, MAX_ROOTS);
    expect(validateRoots(ten)).toEqual({ ok: true, roots: ten });
    // An invalid root rejects the whole list; valid ones are normalized and deduped.
    expect(validateRoots(['docs', '../x']).ok).toBe(false);
    expect(validateRoots(['./docs/', 'docs'])).toEqual({ ok: true, roots: ['docs'] });
    expect(isUnderRoots('docs/a.md', ['docs'])).toBe(true);
    expect(isUnderRoots('docs-x/a.md', ['docs'])).toBe(false);
  });

  it('AC-CTX-50 rejects q>200', () => {
    expect(queryValid('x'.repeat(MAX_QUERY_LENGTH))).toBe(true);
    expect(queryValid('x'.repeat(MAX_QUERY_LENGTH + 1))).toBe(false);
    expect(queryValid(undefined)).toBe(true);
  });

  it('AC-CTX-32 rejects .env', () => {
    expect(normalizeContextPath('.env').ok).toBe(false);
    expect(normalizeContextPath('docs/.env.md').ok).toBe(false);
    expect(normalizeContextPath('docs/id_rsa').ok).toBe(false);
    expect(normalizeContextPath('docs/a.md').ok).toBe(true);
  });

  it('AC-CTX-03 planRootsUpsert: none→insert, one→update, many→update first + delete rest', () => {
    expect(planRootsUpsert([])).toEqual({ updateId: null, deleteIds: [], insert: true });
    expect(planRootsUpsert(['a'])).toEqual({ updateId: 'a', deleteIds: [], insert: false });
    expect(planRootsUpsert(['a', 'b', 'c'])).toEqual({ updateId: 'a', deleteIds: ['b', 'c'], insert: false });
  });
});
