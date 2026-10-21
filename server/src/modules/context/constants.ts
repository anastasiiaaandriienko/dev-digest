/**
 * Project Context folder — single source of truth for the limits (spec §8,
 * L1–L9) and the fixed strings. Only this module and the review executor
 * may use the limit constants (AC-CTX-67).
 */

/** L1 — files kept per discovery. */
export const MAX_CONTEXT_FILES = 500;
/** L2 — directory depth below a root (a root's own folder is depth 0). */
export const MAX_CONTEXT_DEPTH = 8;
/** L3 — discovery time budget in milliseconds. */
export const MAX_DISCOVERY_MS = 2000;
/** L4 — bytes read per doc (preview, search, injection). */
export const MAX_DOC_BYTES = 32_768;
/** L5 — tokens per injected doc entry (entry + marker). */
export const MAX_DOC_TOKENS = 4000;
/** L6 — Project-context tokens per prompt. */
export const MAX_PROMPT_TOKENS = 12_000;
/** L7 — attachments per agent per repo, and per skill per repo. */
export const MAX_ATTACHMENTS = 10;
/** L8 — search query length (chars). */
export const MAX_QUERY_LENGTH = 200;
/** L9 — roots per repo. */
export const MAX_ROOTS = 10;

/** Roots used while a repo has no saved roots row (spec AC-CTX-02). */
export const DEFAULT_ROOTS: readonly string[] = ['specs', 'docs', 'insights'];

/** Only this extension is discovered (`.mdx`, `.markdown` are not). */
export const DOC_EXTENSION = '.md';

/** Directory names never entered by the walk (dot-dirs are skipped too). */
export const CONTEXT_SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', 'dist']);

/** `settings.key` prefix; the full key is `context_roots:<repoId>`. */
export const ROOTS_KEY_PREFIX = 'context_roots:';

/** Reasons recorded in the trace / run log for a doc that was not injected. */
export const SKIP_REASONS = {
  duplicate: 'duplicate',
  attachmentLimit: 'attachment limit',
  outsideRoots: 'outside roots',
  budgetExhausted: 'budget exhausted',
  repoNotCloned: 'repo not cloned',
  singleLongLine: 'single line longer than the limit',
} as const;

/** Appended when a doc entry is cut to fit L5. */
export const TRUNCATION_MARKER = '[… truncated: project-context size limit]';

/** Persisted in place of a read doc's text (spec §6, AC-CTX-72). */
export function placeholderLine(path: string, tokens: number, truncated: boolean): string {
  return `[project-context omitted from trace] path=${path} tokens=${tokens} truncated=${truncated}`;
}

/** Persisted `user` when the Project Context section cannot be located (AC-CTX-73). */
export const USER_OMITTED_PLACEHOLDER =
  '[user prompt omitted from trace: project context could not be isolated]';
