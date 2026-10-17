import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RipgrepCodeIndex } from '../src/adapters/codeindex/ripgrep.js';

/**
 * The ripgrep CodeIndex feeds the blast-radius fallback. Its paths must be
 * repo-relative POSIX like every index table; on Windows `relative()` alone
 * returned backslash paths that never matched the PR's changed files.
 */
describe('RipgrepCodeIndex paths', () => {
  let root: string;
  const repo = { owner: 'acme', name: 'api' };
  const index = () => new RipgrepCodeIndex({ clonePathFor: () => root });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'codeindex-'));
    await mkdir(join(root, 'src', 'lib'), { recursive: true });
    await writeFile(join(root, 'src', 'lib', 'helpers.ts'), 'export function toDto(x: number) { return x; }\n');
    await writeFile(join(root, 'src', 'service.ts'), "import { toDto } from './lib/helpers';\nexport const list = () => toDto(1);\n");
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('symbols() returns repo-relative POSIX paths', async () => {
    const symbols = await index().symbols(repo);
    expect(symbols).toContainEqual(expect.objectContaining({ path: 'src/lib/helpers.ts', name: 'toDto' }));
    expect(symbols.every((s) => !s.path.includes('\\'))).toBe(true);
  });

  it('references() returns repo-relative POSIX paths', async () => {
    const refs = await index().references(repo, 'toDto');
    expect(refs).toContainEqual(expect.objectContaining({ fromPath: 'src/service.ts', line: 2 }));
    expect(refs.every((r) => !r.fromPath.includes('\\'))).toBe(true);
  });
});
