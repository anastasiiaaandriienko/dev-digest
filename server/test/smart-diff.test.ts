import { describe, it, expect } from 'vitest';
import { SMART_GROUP_ORDER, SmartDiff } from '@devdigest/shared';
import {
  anchorLine,
  buildSmartDiff,
  newSideLines,
  type SmartDiffFileInput,
} from '../src/modules/reviews/smart-diff.js';
import { SMART_DIFF_SPLIT_THRESHOLD_LINES } from '../src/modules/reviews/constants.js';

/** GET /pulls/:id/smart-diff — the pure builder (grouping, anchoring, split hint). */

// new-side lines 10, 11 (added), 12 (context); old line 10 deleted.
const PATCH = '@@ -10,2 +10,3 @@ fn()\n-old\n+new one\n+new two\n ctx';

const file = (path: string, over: Partial<SmartDiffFileInput> = {}): SmartDiffFileInput => ({
  path,
  additions: 1,
  deletions: 0,
  patch: PATCH,
  ...over,
});

const finding = (f: string, start: number, end = start) => ({ file: f, start_line: start, end_line: end });

const roleOf = (d: SmartDiff, path: string) => d.groups.find((g) => g.files.some((f) => f.path === path))?.role;
const fileOf = (d: SmartDiff, path: string) => d.groups.flatMap((g) => g.files).find((f) => f.path === path)!;

describe('newSideLines', () => {
  it('counts added + context lines, skips deletions and "no newline" markers', () => {
    expect([...newSideLines(PATCH)]).toEqual([10, 11, 12]);
    expect([...newSideLines('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file')]).toEqual([1]);
  });

  it('handles several hunks, CRLF, a trailing newline and empty / null patches', () => {
    expect([...newSideLines('@@ -1,1 +1,1 @@\r\n+a\r\n@@ -9,1 +20,2 @@\r\n x\r\n+y\r\n')]).toEqual([1, 20, 21]);
    expect(newSideLines(null).size).toBe(0);
    expect(newSideLines('').size).toBe(0);
    expect(newSideLines('not a patch\n+line').size).toBe(0);
  });
});

describe('anchorLine', () => {
  const lines = new Set([10, 11, 12]);
  it('prefers end_line, else the largest rendered line in range', () => {
    expect(anchorLine(lines, finding('a', 1, 11))).toBe(11);
    expect(anchorLine(lines, finding('a', 5, 30))).toBe(12);
    expect(anchorLine(lines, finding('a', 30, 5))).toBe(12); // reversed range
  });

  it('returns null for lines off the changed side, non-positive or non-integer lines', () => {
    expect(anchorLine(lines, finding('a', 40, 50))).toBeNull();
    expect(anchorLine(lines, finding('a', 0))).toBeNull();
    expect(anchorLine(lines, finding('a', -3))).toBeNull();
    expect(anchorLine(lines, finding('a', Number.NaN))).toBeNull();
    expect(anchorLine(lines, finding('a', 10.5))).toBeNull();
    expect(anchorLine(new Set(), finding('a', 10))).toBeNull();
  });
});

describe('buildSmartDiff', () => {
  it('always returns the five groups in SMART_GROUP_ORDER, also for an empty PR', () => {
    const d = buildSmartDiff([], []);
    expect(() => SmartDiff.parse(d)).not.toThrow();
    expect(d.groups.map((g) => g.role)).toEqual([...SMART_GROUP_ORDER]);
    expect(d.groups.every((g) => g.files.length === 0)).toBe(true);
    expect(d.split_suggestion).toEqual({ too_big: false, total_lines: 0, proposed_splits: [] });
    expect(d.findings_outside_diff).toBe(0);
  });

  it('classifies with the shared rules (priority boilerplate → tests → wiring → docs → core)', () => {
    const d = buildSmartDiff(
      [
        file('src/a.ts'),
        file('src/a.test.ts'),
        file('package.json'),
        file('docs/guide.md'),
        file('pnpm-lock.yaml'),
        file('docs/mkdocs.yml'), // docs + wiring → wiring
        file('test/fixtures/README.md'), // tests + docs → tests
        file('dist/README.md'), // boilerplate + docs → boilerplate
      ],
      [],
    );
    expect(roleOf(d, 'src/a.ts')).toBe('core');
    expect(roleOf(d, 'src/a.test.ts')).toBe('tests');
    expect(roleOf(d, 'package.json')).toBe('wiring');
    expect(roleOf(d, 'docs/guide.md')).toBe('docs');
    expect(roleOf(d, 'pnpm-lock.yaml')).toBe('boilerplate');
    expect(roleOf(d, 'docs/mkdocs.yml')).toBe('wiring');
    expect(roleOf(d, 'test/fixtures/README.md')).toBe('tests');
    expect(roleOf(d, 'dist/README.md')).toBe('boilerplate');
  });

  it('sorts files by path inside each group and keeps one entry per path', () => {
    const d = buildSmartDiff([file('src/z.ts'), file('src/B.ts'), file('src/a.ts'), file('src/a.ts', { additions: 9 })], []);
    const core = d.groups.find((g) => g.role === 'core')!;
    expect(core.files.map((f) => f.path)).toEqual(['src/B.ts', 'src/a.ts', 'src/z.ts']);
    expect(core.files.find((f) => f.path === 'src/a.ts')!.additions).toBe(1); // first row wins
  });

  it('is deterministic regardless of input order and does not mutate inputs', () => {
    const files = [file('src/b.ts'), file('README.md'), file('src/a.ts')];
    const findings = [finding('src/a.ts', 11), finding('src/b.ts', 12), finding('src/a.ts', 10)];
    const copy = structuredClone({ files, findings });
    const first = buildSmartDiff(files, findings);
    const second = buildSmartDiff([...files].reverse(), [...findings].reverse());
    expect(second).toEqual(first);
    expect({ files, findings }).toEqual(copy);
  });

  it('reports finding_lines ascending and unique; counts all and unanchored findings per file', () => {
    const d = buildSmartDiff(
      [file('src/a.ts')],
      [finding('src/a.ts', 12), finding('src/a.ts', 10), finding('src/a.ts', 10), finding('src/a.ts', 5, 11), finding('src/a.ts', 0), finding('src/a.ts', 90)],
    );
    expect(fileOf(d, 'src/a.ts')).toMatchObject({ finding_lines: [10, 11, 12], findings_count: 6, unanchored_findings: 2 });
  });

  it('treats every finding on a file without a patch (binary/oversized) as unanchored', () => {
    const d = buildSmartDiff([file('public/logo.png', { patch: null })], [finding('public/logo.png', 1)]);
    expect(fileOf(d, 'public/logo.png')).toMatchObject({ finding_lines: [], findings_count: 1, unanchored_findings: 1 });
  });

  it('counts findings on files outside the diff without adding them to any group', () => {
    const d = buildSmartDiff([file('src/a.ts')], [finding('src/gone.ts', 3), finding('src/a.ts', 10)]);
    expect(d.findings_outside_diff).toBe(1);
    expect(d.groups.flatMap((g) => g.files).map((f) => f.path)).toEqual(['src/a.ts']);
  });

  describe('split_suggestion', () => {
    const big = SMART_DIFF_SPLIT_THRESHOLD_LINES;

    it('is not too big at the threshold, too big above it; boilerplate lines do not count', () => {
      const at = buildSmartDiff([file('src/a.ts', { additions: big, deletions: 0 }), file('pnpm-lock.yaml', { additions: 5000 })], []);
      expect(at.split_suggestion).toEqual({ too_big: false, total_lines: big, proposed_splits: [] });
      const over = buildSmartDiff([file('src/a.ts', { additions: big, deletions: 1 })], []);
      expect(over.split_suggestion.too_big).toBe(true);
      expect(over.split_suggestion.total_lines).toBe(big + 1);
    });

    it('proposes one split per non-empty role (boilerplate never on its own), in group order', () => {
      const d = buildSmartDiff(
        [
          file('src/a.ts', { additions: big }),
          file('src/a.test.ts', { additions: 10 }),
          file('docs/a.md', { additions: 5 }),
          file('pnpm-lock.yaml', { additions: 900 }),
        ],
        [],
      );
      expect(d.split_suggestion.proposed_splits).toEqual([
        { name: 'core', files: ['src/a.ts'] },
        { name: 'tests', files: ['src/a.test.ts'] },
        { name: 'docs', files: ['docs/a.md'] },
      ]);
    });

    it('falls back to leading directories when every file has the same role', () => {
      const d = buildSmartDiff(
        [
          file('server/src/x.ts', { additions: big }),
          file('client/src/y.ts', { additions: 3 }),
          file('client/src/z.ts', { additions: 3 }),
          file('root.ts', { additions: 1 }),
        ],
        [],
      );
      expect(d.split_suggestion.proposed_splits).toEqual([
        { name: 'core: .', files: ['root.ts'] },
        { name: 'core: client/src', files: ['client/src/y.ts', 'client/src/z.ts'] },
        { name: 'core: server/src', files: ['server/src/x.ts'] },
      ]);
    });

    it('proposes nothing when a single role and a single directory hold everything', () => {
      const d = buildSmartDiff([file('src/a.ts', { additions: big + 50 })], []);
      expect(d.split_suggestion).toEqual({ too_big: true, total_lines: big + 50, proposed_splits: [] });
    });
  });
});
