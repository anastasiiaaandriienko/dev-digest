import { createHash } from 'node:crypto';
import { FINGERPRINT_VERSION } from './constants.js';

/**
 * Input fingerprint of an intent: a sha256 over a canonical JSON of everything
 * the intent is derived from. Model and prompt version are NOT part of it — they
 * are stored in their own columns so staleness can name the reason.
 */

/** `@@ -a,b +c,d @@ <function context>` — the diff-parser drops the context, so read the raw patch. */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/;

const normalize = (text: string | null | undefined): string => (text ?? '').replace(/\r\n?/g, '\n').trim();

/** Full hunk header lines (with function context) of a raw unified patch, in order. */
export function extractHunkHeaders(patch: string | null | undefined): string[] {
  if (!patch) return [];
  const headers: string[] = [];
  for (const line of patch.replace(/\r\n?/g, '\n').split('\n')) {
    if (HUNK_HEADER.test(line)) headers.push(line.trimEnd());
  }
  return headers;
}

export interface IntentFileInput {
  path: string;
  additions: number;
  deletions: number;
  /** Raw unified-diff patch as stored in `pr_files.patch`. */
  patch: string | null;
}

/**
 * `null` (unknown) when no `pr_files` are stored locally. Absence of rows never
 * means "the PR has no files": the GitHub list sync stores `files_count: 0` for
 * every imported PR, so `filesCount` cannot prove emptiness either.
 */
export function knownFiles(files: IntentFileInput[]): IntentFileInput[] | null {
  return files.length === 0 ? null : files;
}

export interface FingerprintInput {
  title: string;
  body: string | null;
  headSha: string;
  base: string;
  files: IntentFileInput[] | null;
  /**
   * Locally known context (`localContextFingerprint`): issue/link refs from the
   * description and plan-doc text hashes. Omitted/null = none, and then the key
   * is left out so PRs without context keep their earlier fingerprint. Fetched
   * issue content is NOT here (GET never calls GitHub); POST compares it separately.
   */
  context?: unknown;
}

/** The exact object that is hashed (exported for tests / debugging). */
export function canonicalInput(input: FingerprintInput) {
  const files = input.files
    ? [...input.files]
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map((f) => ({ path: f.path, hunks: extractHunkHeaders(f.patch) }))
    : null;
  return {
    v: FINGERPRINT_VERSION,
    title: normalize(input.title),
    body: normalize(input.body),
    head_sha: input.headSha,
    base: input.base,
    files,
    ...(input.context != null ? { context: input.context } : {}),
  };
}

export function computeFingerprint(input: FingerprintInput): string {
  return createHash('sha256').update(JSON.stringify(canonicalInput(input))).digest('hex');
}
