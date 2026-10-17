/**
 * depgraph adapter — edges must use the same repo-relative POSIX paths as
 * walkClone() (symbols.path / file_edges.from_file).
 *
 * Regression: on Windows `path.relative` returns backslash paths, so every
 * cruise edge missed the POSIX file set and `file_edges` ended up empty —
 * which left every `references.decl_file` unresolved. A cruise failure must
 * also reach the pipeline (stats.graphFailed → status 'partial') instead of
 * being swallowed into an empty graph.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, win32, posix } from 'node:path';
import { DepCruiseGraph, toRepoRelative } from '../src/adapters/depgraph/index.js';

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

describe('toRepoRelative', () => {
  it('turns a Windows absolute path into a repo-relative POSIX path', () => {
    expect(toRepoRelative('C:\\repo', 'C:\\repo\\src\\lib\\b.ts', win32)).toBe('src/lib/b.ts');
  });

  it('keeps POSIX paths as they are', () => {
    expect(toRepoRelative('/repo', '/repo/src/lib/b.ts', posix)).toBe('src/lib/b.ts');
  });

  it('resolves cruise output relative to the root, not the process cwd', () => {
    expect(toRepoRelative('D:\\clones\\app', 'src\\lib\\b.ts', win32)).toBe('src/lib/b.ts');
    expect(toRepoRelative('/clones/app', 'src/lib/b.ts', posix)).toBe('src/lib/b.ts');
  });
});

describe('DepCruiseGraph.buildEdges', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'depgraph-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns edges between nested files as repo-relative POSIX paths', async () => {
    await writeFileAt(root, 'src/a.ts', `import { b } from './lib/b';\nexport const a = () => b();\n`);
    await writeFileAt(root, 'src/lib/b.ts', `import { c } from '../util/c';\nexport const b = () => c();\n`);
    await writeFileAt(root, 'src/util/c.ts', `export const c = () => 1;\n`);

    const edges = await new DepCruiseGraph().buildEdges(root, ['src/a.ts', 'src/lib/b.ts', 'src/util/c.ts']);

    expect(edges).toEqual(
      expect.arrayContaining([
        { from: 'src/a.ts', to: 'src/lib/b.ts' },
        { from: 'src/lib/b.ts', to: 'src/util/c.ts' },
      ]),
    );
    expect(edges).toHaveLength(2);
  });

  it('returns [] without calling cruise when there are no files', async () => {
    await expect(new DepCruiseGraph().buildEdges(root, [])).resolves.toEqual([]);
  });
});

describe('DepCruiseGraph.buildEdges — cruise failure', () => {
  afterEach(() => {
    vi.doUnmock('dependency-cruiser');
    vi.resetModules();
  });

  it('rejects instead of returning an empty graph', async () => {
    vi.resetModules();
    vi.doMock('dependency-cruiser', () => ({
      cruise: () => {
        throw new Error('cruise exploded');
      },
    }));
    const { DepCruiseGraph: Graph } = await import('../src/adapters/depgraph/index.js');

    await expect(new Graph().buildEdges('/repo', ['src/a.ts'])).rejects.toThrow('cruise exploded');
  });
});
