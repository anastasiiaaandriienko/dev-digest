import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkDocs } from '../src/modules/context/discovery.js';
import { DEFAULT_ROOTS, MAX_CONTEXT_FILES } from '../src/modules/context/constants.js';

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'ctx-walk-')));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const put = async (rel: string, body = '# doc\n') => {
  const full = join(root, ...rel.split('/'));
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, body);
};
const paths = async (roots: readonly string[], opts?: Parameters<typeof walkDocs>[2]) =>
  (await walkDocs(root, roots, opts)).files.map((f) => f.path);

// Directory junctions work on Windows without privileges; file symlinks may not.
const canSymlinkFiles = await (async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'ctx-probe-')));
  try {
    await writeFile(join(dir, 't'), 'x');
    await symlink(join(dir, 't'), join(dir, 'l'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
})();

describe('walkDocs', () => {
  it('AC-CTX-01 order: roots in order, DFS pre-order, UTF-16 sort, one entry per path', async () => {
    await put('docs/b.md');
    await put('docs/a/z.md');
    await put('docs/a/B.md');
    await put('docs/a.md');
    await put('specs/s.md');
    // Entries sort by name: 'a' (dir) < 'a.md' < 'b.md'; inside the dir 'B' (0x42) < 'z'.
    // A dir is walked in place (pre-order).
    expect(await paths(['specs', 'docs'])).toEqual([
      'specs/s.md',
      'docs/a/B.md',
      'docs/a/z.md',
      'docs/a.md',
      'docs/b.md',
    ]);
    // Overlapping roots: the first occurrence wins, no duplicates.
    expect(await paths(['docs', 'docs/a'])).toEqual(['docs/a/B.md', 'docs/a/z.md', 'docs/a.md', 'docs/b.md']);
    const [first] = (await walkDocs(root, ['specs'])).files;
    expect(Object.keys(first!).sort()).toEqual(['path', 'size', 'updated_at']);
    expect(first!.size).toBe('# doc\n'.length);
  });

  it('AC-CTX-02 default roots: specs, docs, insights', async () => {
    await put('insights/i.md');
    await put('docs/d.md');
    await put('specs/s.md');
    await put('other/o.md');
    expect([...DEFAULT_ROOTS]).toEqual(['specs', 'docs', 'insights']);
    expect(await paths(DEFAULT_ROOTS)).toEqual(['specs/s.md', 'docs/d.md', 'insights/i.md']);
  });

  it('AC-CTX-05 skip list: non-.md, node_modules, dist, dot-dirs', async () => {
    await put('docs/a.md');
    await put('docs/b.mdx');
    await put('docs/c.markdown');
    await put('docs/d.txt');
    await put('docs/node_modules/x.md');
    await put('docs/dist/x.md');
    await put('docs/.hidden/x.md');
    await put('docs/sub/e.md');
    expect(await paths(['docs'])).toEqual(['docs/a.md', 'docs/sub/e.md']);
  });

  it('AC-CTX-06 symlinked dir not followed', async () => {
    await put('outside/secret.md');
    await put('docs/a.md');
    await symlink(join(root, 'outside'), join(root, 'docs', 'link'), 'junction');
    expect(await paths(['docs'])).toEqual(['docs/a.md']);
  });

  it.skipIf(!canSymlinkFiles)('AC-CTX-05 symlinked .md file is skipped', async () => {
    await put('outside/secret.md');
    await put('docs/a.md');
    await symlink(join(root, 'outside', 'secret.md'), join(root, 'docs', 'b.md'), 'file');
    expect(await paths(['docs'])).toEqual(['docs/a.md']);
  });

  it('AC-CTX-06 a symlinked root is not entered', async () => {
    await put('real/a.md');
    await symlink(join(root, 'real'), join(root, 'docs'), 'junction');
    expect(await paths(['docs'])).toEqual([]);
  });

  it('AC-CTX-07 file_limit: first 500 kept, truncated', async () => {
    const total = MAX_CONTEXT_FILES + 1;
    await mkdir(join(root, 'docs'), { recursive: true });
    for (let i = 0; i < total; i++) await writeFile(join(root, 'docs', `f${String(i).padStart(4, '0')}.md`), 'x');
    const res = await walkDocs(root, ['docs']);
    expect(res.files).toHaveLength(MAX_CONTEXT_FILES);
    expect(res.files[0]!.path).toBe('docs/f0000.md');
    expect(res.files.at(-1)!.path).toBe(`docs/f${String(MAX_CONTEXT_FILES - 1).padStart(4, '0')}.md`);
    expect(res.truncated).toBe(true);
    expect(res.truncated_reasons).toEqual(['file_limit']);
  });

  it('AC-CTX-07 exactly 500 files is not truncated', async () => {
    await mkdir(join(root, 'docs'), { recursive: true });
    for (let i = 0; i < MAX_CONTEXT_FILES; i++) await writeFile(join(root, 'docs', `f${i}.md`), 'x');
    const res = await walkDocs(root, ['docs']);
    expect(res.files).toHaveLength(MAX_CONTEXT_FILES);
    expect(res.truncated).toBe(false);
  });

  it('AC-CTX-47 depth_limit: folders deeper than 8 levels are not entered', async () => {
    const deep8 = ['docs', ...Array.from({ length: 8 }, (_, i) => `d${i + 1}`)].join('/');
    await put(`${deep8}/ok.md`);
    await put(`${deep8}/d9/too-deep.md`);
    const res = await walkDocs(root, ['docs']);
    expect(res.files.map((f) => f.path)).toEqual([`${deep8}/ok.md`]);
    expect(res.truncated_reasons).toEqual(['depth_limit']);
    expect(res.truncated).toBe(true);
  });

  it('AC-CTX-48 time_limit: injected clock stops the walk, keeps the prefix in order', async () => {
    for (const n of ['a', 'b', 'c', 'd', 'e']) await put(`docs/${n}.md`);
    let calls = 0;
    // Calls 1-5 (start, folder entry, entries a-c) happen at t=0; later ones at t=5 s.
    const now = () => (++calls <= 5 ? 0 : 5000);
    const res = await walkDocs(root, ['docs'], { now });
    expect(res.files.map((f) => f.path)).toEqual(['docs/a.md', 'docs/b.md', 'docs/c.md']);
    expect(res.truncated_reasons).toEqual(['time_limit']);
  });

  it('AC-CTX-42 missing root contributes nothing, others still listed', async () => {
    await put('docs/a.md');
    const res = await walkDocs(root, ['nope', 'docs', 'also/missing']);
    expect(res.files.map((f) => f.path)).toEqual(['docs/a.md']);
    expect(res.truncated).toBe(false);
    expect(res.truncated_reasons).toEqual([]);
  });

  it('AC-CTX-32 .env not listed (sensitive names excluded even with .md)', async () => {
    await put('docs/.env.md');
    await put('docs/secrets.json');
    await put('docs/a.md');
    expect(await paths(['docs'])).toEqual(['docs/a.md']);
  });
});
