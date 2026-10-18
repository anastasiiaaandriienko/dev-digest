import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { unsafeRepoPath } from '../conventions/samples.js';
import {
  CONTEXT_SKIP_DIRS,
  DOC_EXTENSION,
  MAX_CONTEXT_DEPTH,
  MAX_CONTEXT_FILES,
  MAX_DISCOVERY_MS,
} from './constants.js';
import { checkDirChain } from './read.js';

export type TruncatedReason = 'file_limit' | 'depth_limit' | 'time_limit';

export interface DiscoveredDoc {
  path: string;
  size: number;
  updated_at: string;
}

export interface DiscoveryResult {
  files: DiscoveredDoc[];
  truncated: boolean;
  truncated_reasons: TruncatedReason[];
}

/**
 * Walk the roots of a clone worktree and list `.md` docs (spec §8): roots in the
 * given order, depth-first pre-order, entries sorted by UTF-16 code unit, one
 * entry per path across overlapping roots. Skips symlinks (files and folders),
 * `node_modules`, `dist`, dot-dirs and sensitive names. Bounded by 500 files,
 * 8 levels below a root and 2 s (`now` is injectable). A missing root adds nothing.
 * `cloneRoot` must already be a real path.
 */
export async function walkDocs(
  cloneRoot: string,
  roots: readonly string[],
  opts: { now?: () => number } = {},
): Promise<DiscoveryResult> {
  const now = opts.now ?? Date.now;
  const start = now();
  const files: DiscoveredDoc[] = [];
  const seen = new Set<string>();
  const reasons = new Set<TruncatedReason>();
  let stop = false;

  const timedOut = (): boolean => {
    if (now() - start > MAX_DISCOVERY_MS) {
      reasons.add('time_limit');
      stop = true;
    }
    return stop;
  };

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (timedOut()) return;
    let entries;
    try {
      entries = await readdir(join(cloneRoot, ...rel.split('/')), { withFileTypes: true });
    } catch {
      return; // unreadable folder: contributes nothing
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (timedOut()) return;
      if (e.isSymbolicLink()) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || CONTEXT_SKIP_DIRS.has(e.name)) continue;
        if (depth + 1 > MAX_CONTEXT_DEPTH) {
          reasons.add('depth_limit');
          continue;
        }
        await walk(child, depth + 1);
        if (stop) return;
      } else if (e.isFile() && e.name.endsWith(DOC_EXTENSION)) {
        if (unsafeRepoPath(child) || seen.has(child)) continue;
        if (files.length >= MAX_CONTEXT_FILES) {
          reasons.add('file_limit');
          stop = true;
          return;
        }
        try {
          const st = await lstat(join(cloneRoot, ...child.split('/')));
          seen.add(child);
          files.push({ path: child, size: st.size, updated_at: st.mtime.toISOString() });
        } catch {
          // vanished between readdir and lstat
        }
      }
    }
  };

  for (const root of roots) {
    if (stop) break;
    // The root itself (and every parent) must be a real directory, not a link.
    if ((await checkDirChain(cloneRoot, root.split('/'))) !== null) continue;
    await walk(root, 0);
  }

  const truncated_reasons = (['file_limit', 'depth_limit', 'time_limit'] as const).filter((r) =>
    reasons.has(r),
  );
  return { files, truncated: truncated_reasons.length > 0, truncated_reasons };
}
