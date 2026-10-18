import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchesQuery, readContextDoc } from '../src/modules/context/read.js';
import { MAX_DOC_BYTES } from '../src/modules/context/constants.js';

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'ctx-read-')));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const put = async (rel: string, body: string | Buffer) => {
  const full = join(root, ...rel.split('/'));
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, body);
};

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

describe('readContextDoc', () => {
  it('AC-CTX-10 truncated flag: false for a small doc, true when cut', async () => {
    await put('docs/small.md', '# hi\n');
    const small = await readContextDoc(root, 'docs/small.md');
    expect(small).toMatchObject({ kind: 'ok', text: '# hi\n', truncated: false, size: 5 });
    await put('docs/big.md', 'line\n'.repeat(10_000));
    const big = await readContextDoc(root, 'docs/big.md');
    expect(big).toMatchObject({ kind: 'ok', truncated: true });
  });

  it('AC-CTX-66 cut at last newline within 32 KB', async () => {
    await put('docs/big.md', 'abcdefghi\n'.repeat(5000)); // 50,000 bytes
    const r = await readContextDoc(root, 'docs/big.md');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.text)).toBeLessThanOrEqual(MAX_DOC_BYTES);
    expect(r.text.endsWith('abcdefghi')).toBe(true); // last newline excluded, no partial line
    expect(r.text.split('\n').every((l) => l === 'abcdefghi')).toBe(true);
  });

  it('AC-CTX-74 single long line skipped', async () => {
    await put('docs/long.md', 'a'.repeat(MAX_DOC_BYTES + 100));
    expect(await readContextDoc(root, 'docs/long.md')).toEqual({
      kind: 'skip',
      reason: 'single line longer than the limit',
    });
  });

  it('AC-CTX-40 binary/non-UTF-8 skipped', async () => {
    await put('docs/bin.md', Buffer.from([0x23, 0x20, 0x00, 0x01, 0x02]));
    await put('docs/latin1.md', Buffer.from([0x68, 0xe9, 0xff, 0x0a]));
    expect(await readContextDoc(root, 'docs/bin.md')).toEqual({ kind: 'skip', reason: 'binary file' });
    expect(await readContextDoc(root, 'docs/latin1.md')).toEqual({ kind: 'skip', reason: 'not UTF-8 text' });
  });

  it.skipIf(!canSymlinkFiles)('AC-CTX-29 symlink file skipped without reading', async () => {
    await put('outside/secret.md', 'TOP SECRET\n');
    await mkdir(join(root, 'docs'), { recursive: true });
    await symlink(join(root, 'outside', 'secret.md'), join(root, 'docs', 'link.md'), 'file');
    const r = await readContextDoc(root, 'docs/link.md');
    expect(r).toEqual({ kind: 'skip', reason: 'symbolic link' });
  });

  it('AC-CTX-29 symlinked parent folder / outside clone skipped', async () => {
    await put('outside/secret.md', 'TOP SECRET\n');
    await symlink(join(root, 'outside'), join(root, 'docs'), 'junction');
    const r = await readContextDoc(root, 'docs/secret.md');
    expect(r).toEqual({ kind: 'skip', reason: 'symbolic link' });
  });

  it('AC-CTX-29 unsafe paths are skipped without a read', async () => {
    expect(await readContextDoc(root, '../x.md')).toEqual({ kind: 'skip', reason: 'path traversal' });
    expect(await readContextDoc(root, '/etc/x.md')).toEqual({ kind: 'skip', reason: 'absolute path' });
  });

  it('AC-CTX-31 secrets redacted', async () => {
    await put('docs/s.md', 'key AKIAABCDEFGHIJKLMNOP\npassword = "hunter2hunter2"\nok\n');
    const r = await readContextDoc(root, 'docs/s.md');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.text).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(r.text).not.toContain('hunter2hunter2');
    expect(r.text).toContain('[REDACTED]');
    expect(r.text).toContain('ok');
  });

  it('AC-CTX-09 match path or content, case-insensitive, on redacted text', async () => {
    expect(matchesQuery('docs/Auth.md', 'nothing', 'AUTH')).toBe(true);
    expect(matchesQuery('docs/a.md', 'Some Needle here', 'needle')).toBe(true);
    expect(matchesQuery('docs/a.md', 'haystack', 'needle')).toBe(false);
    await put('docs/s.md', 'token AKIAABCDEFGHIJKLMNOP\n');
    const r = await readContextDoc(root, 'docs/s.md');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(matchesQuery('docs/s.md', r.text, 'AKIAABCDEFGHIJKLMNOP')).toBe(false);
    expect(matchesQuery('docs/s.md', r.text, '[redacted]')).toBe(true);
  });

  it('AC-CTX-38 deleted file -> missing, not unreadable', async () => {
    expect(await readContextDoc(root, 'docs/gone.md')).toEqual({ kind: 'missing' });
    // A missing parent folder is missing too.
    expect(await readContextDoc(root, 'nodir/sub/gone.md')).toEqual({ kind: 'missing' });
  });

  it('AC-CTX-64 PR-head-only doc -> missing (only the worktree is read)', async () => {
    await put('docs/on-default-branch.md', 'x\n');
    // docs/pr-only.md exists only on the PR head ref, never in the worktree.
    expect(await readContextDoc(root, 'docs/pr-only.md')).toEqual({ kind: 'missing' });
  });
});
