import { unsafeRepoPath } from '../conventions/samples.js';
import { DEFAULT_ROOTS, MAX_QUERY_LENGTH, MAX_ROOTS, ROOTS_KEY_PREFIX } from './constants.js';

/** `settings` key of a repo's roots row. */
export function rootsKey(repoId: string): string {
  return `${ROOTS_KEY_PREFIX}${repoId}`;
}

export type PathResult = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Normalize a user-supplied repo-relative path (spec §9): strip a leading `./`,
 * collapse repeated `/`, drop `.` segments and a trailing `/`; then reject what
 * `unsafeRepoPath` rejects (absolute, drive letter, `..`, `\`, control chars,
 * sensitive names). Backslashes are rejected, never converted; case is kept.
 */
export function normalizeContextPath(input: string): PathResult {
  if (typeof input !== 'string') return { ok: false, reason: 'empty or over-long path' };
  // Reject before touching separators so `\` is never silently converted.
  if (input.includes('\\')) return { ok: false, reason: 'invalid characters' };
  const absolute = input.startsWith('/') || /^[a-zA-Z]:/.test(input);
  if (absolute) return { ok: false, reason: 'absolute path' };
  const segments = input.split('/').filter((s) => s !== '' && s !== '.');
  const path = segments.join('/');
  const unsafe = unsafeRepoPath(path);
  return unsafe ? { ok: false, reason: unsafe } : { ok: true, path };
}

export type RootsResult = { ok: true; roots: string[] } | { ok: false; reason: string };

/** Normalize and validate a roots list (L9, spec §9). Duplicates collapse, order is kept. */
export function validateRoots(input: readonly string[]): RootsResult {
  if (input.length > MAX_ROOTS) return { ok: false, reason: `too many roots (max ${MAX_ROOTS})` };
  const roots: string[] = [];
  for (const raw of input) {
    const n = normalizeContextPath(raw);
    if (!n.ok) return { ok: false, reason: `invalid root "${raw}": ${n.reason}` };
    if (!roots.includes(n.path)) roots.push(n.path);
  }
  return { ok: true, roots };
}

/** Saved roots, or the defaults when a repo has none (AC-CTX-02). */
export function effectiveRoots(saved: readonly string[] | null | undefined): string[] {
  return saved ? [...saved] : [...DEFAULT_ROOTS];
}

/** True when `path` equals a root or lies inside one (case-sensitive). */
export function isUnderRoots(path: string, roots: readonly string[]): boolean {
  return roots.some((r) => path === r || path.startsWith(`${r}/`));
}

/** L8: the search query may be at most 200 chars. */
export function queryValid(q: string | undefined): boolean {
  return q === undefined || q.length <= MAX_QUERY_LENGTH;
}

export interface RootsUpsertPlan {
  /** Row to update (the first existing one), or null when there is none. */
  updateId: string | null;
  /** Duplicate rows to delete (all but the first). */
  deleteIds: string[];
  /** True when no row exists and one must be inserted. */
  insert: boolean;
}

/**
 * The settings unique index does not hold for NULL `user_id`, so the roots row
 * is kept to one by hand: update the first, delete the rest, insert if none.
 */
export function planRootsUpsert(existingIds: readonly string[]): RootsUpsertPlan {
  if (existingIds.length === 0) return { updateId: null, deleteIds: [], insert: true };
  return { updateId: existingIds[0]!, deleteIds: existingIds.slice(1), insert: false };
}
