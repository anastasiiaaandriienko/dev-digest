import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { readCloneFile, redactSecrets, unsafeRepoPath } from '../conventions/samples.js';
import { MAX_DOC_BYTES } from './constants.js';

export type ContextDocRead =
  | { kind: 'ok'; text: string; truncated: boolean; size: number; updatedAt: string }
  | { kind: 'missing' }
  | { kind: 'skip'; reason: string };

const isMissing = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

/**
 * Check that every directory on the way to `segments` (relative to the clone) is a
 * real directory. `readCloneFile` only lstats the last segment, so a symlinked
 * parent folder has to be rejected here (spec §9: no symlinked directories).
 * Returns null when the chain is fine, else why it is not.
 */
export async function checkDirChain(
  cloneRoot: string,
  segments: readonly string[],
): Promise<{ missing: true } | { skip: string } | null> {
  let cur = cloneRoot;
  for (const seg of segments) {
    cur = join(cur, seg);
    try {
      const st = await lstat(cur);
      if (st.isSymbolicLink()) return { skip: 'symbolic link' };
      if (!st.isDirectory()) return { skip: 'not a regular file' };
    } catch (err) {
      return isMissing(err) ? { missing: true } : { skip: 'unreadable' };
    }
  }
  return null;
}

/**
 * Read one doc of the clone worktree for preview, search or injection: lstat
 * first (a vanished file is `missing`, not `unreadable`), every parent folder
 * lstat-ed, then the bounded safe read and secret redaction. Never writes.
 */
export async function readContextDoc(
  cloneRoot: string,
  rel: string,
  maxBytes: number = MAX_DOC_BYTES,
): Promise<ContextDocRead> {
  const unsafe = unsafeRepoPath(rel);
  if (unsafe) return { kind: 'skip', reason: unsafe };
  const segments = rel.split('/');
  const parents = await checkDirChain(cloneRoot, segments.slice(0, -1));
  if (parents) return 'missing' in parents ? { kind: 'missing' } : { kind: 'skip', reason: parents.skip };

  let st;
  try {
    st = await lstat(join(cloneRoot, ...segments));
  } catch (err) {
    return isMissing(err) ? { kind: 'missing' } : { kind: 'skip', reason: 'unreadable' };
  }

  const read = await readCloneFile(cloneRoot, rel, maxBytes);
  if ('skip' in read) return { kind: 'skip', reason: read.skip };
  return {
    kind: 'ok',
    text: redactSecrets(read.text).text,
    truncated: read.truncated,
    size: st.size,
    updatedAt: st.mtime.toISOString(),
  };
}

/** Case-insensitive substring match over the path and the (already redacted) text. */
export function matchesQuery(path: string, redactedText: string, q: string): boolean {
  const needle = q.toLowerCase();
  return path.toLowerCase().includes(needle) || redactedText.toLowerCase().includes(needle);
}
