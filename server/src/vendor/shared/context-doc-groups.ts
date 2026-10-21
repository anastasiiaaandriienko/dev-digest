/**
 * Project Context groups — the ONE definition of the headings attached docs are
 * serialized under in the review prompt (`## Project context` → `### <title>`).
 * Pure: no runtime imports, no I/O.
 *
 * Used by the server (prompt assembly of a review run) and the client (the
 * "Serializes as" preview of a skill's docs). The client copy
 * (`client/src/vendor/shared/context-doc-groups.ts`) must stay byte-identical;
 * `server/test/context-doc-groups-sync.test.ts` enforces it.
 *
 * A doc belongs to the group whose `kind` equals the last path segment
 * (lower-cased) of the longest root that contains it; any other root, or no
 * root, gives the "other" group. Groups render in this order.
 */

export const CONTEXT_DOC_GROUPS = [
  { kind: 'specs', title: 'Project specifications' },
  { kind: 'docs', title: 'Project docs' },
  { kind: 'insights', title: 'Project insights' },
  { kind: 'other', title: 'Other project docs' },
] as const;
export type ContextDocGroupKind = (typeof CONTEXT_DOC_GROUPS)[number]['kind'];

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

/** The longest root that equals `path` or contains it (case-sensitive), or null. */
export function contextRootOf(path: string, roots: readonly string[]): string | null {
  let best: string | null = null;
  for (const raw of roots) {
    const root = trimSlashes(raw);
    if (!root) continue;
    if ((path === root || path.startsWith(`${root}/`)) && (best === null || root.length > best.length)) best = root;
  }
  return best;
}

/** Group kind of a doc path under the given roots. */
export function contextDocGroupKind(path: string, roots: readonly string[]): ContextDocGroupKind {
  const root = contextRootOf(path, roots);
  const last = root ? (root.split('/').pop() ?? '').toLowerCase() : '';
  return CONTEXT_DOC_GROUPS.find((g) => g.kind === last)?.kind ?? 'other';
}

/**
 * Stable grouping in prompt order: items keep their relative order inside a
 * group; empty groups are dropped.
 */
export function groupContextDocs<T>(
  items: readonly T[],
  pathOf: (item: T) => string,
  roots: readonly string[],
): { kind: ContextDocGroupKind; title: string; items: T[] }[] {
  return CONTEXT_DOC_GROUPS.map((g) => ({
    kind: g.kind,
    title: g.title,
    items: items.filter((it) => contextDocGroupKind(pathOf(it), roots) === g.kind),
  })).filter((g) => g.items.length > 0);
}
