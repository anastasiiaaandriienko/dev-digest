import { z } from 'zod/v4';
import type { ApiPullLookup } from '../api-schemas.js';
import { ToolInputError } from '../errors.js';
import type { ToolDeps } from './deps.js';

/**
 * One way to name a PR for get_blast_radius, get_findings and run_agent_on_pr:
 * a single `pr_id` string that is the internal uuid, the PR number ("15" or
 * "#15") or part of the PR title, plus an optional `repo` for numbers / titles.
 *
 * A uuid is used as is (no lookup; `repo` does not apply to it). A number or a
 * title goes through GET /pulls (stored PRs only — no GitHub sync, no writes):
 * exactly one match is used; zero or several matches are an error that lists
 * the candidates. The first match is never picked silently.
 */

/** Candidates listed in an "ambiguous" error. */
const MAX_LISTED = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER_RE = /^#?(\d+)$/;
const MIN_TITLE = 2;
const MAX_TITLE = 200;

// A client may send the PR number as a JSON number (e.g. the Inspector CLI turns `pr_id=18` into 18);
// it is accepted and read as "18". The published schema stays `{type: "string"}`, and a missing
// pr_id is still rejected (unlike z.coerce.string(), which would turn it into "undefined").
export const prIdField = z
  .preprocess((value) => (typeof value === 'number' ? String(value) : value), z.string())
  .describe(
    "Pull request: DevDigest's internal pr_id (UUID, e.g. '5f5c6812-462d-4735-ad7c-4cadba36ce61'), " +
      "the PR number (e.g. '#15' or '15'), or part of the PR title (e.g. 'cost tracking')",
  );

export const repoField = z
  .string()
  .optional()
  .describe(
    "Optional repository to search in when pr_id is a number or title: 'owner/name', just 'name' " +
      "(e.g. 'ai-customer-support'), or the repo id",
  );

export interface PrRefArgs {
  pr_id: string;
  repo?: string;
}

export interface ResolvedPr {
  prId: string;
  /** Set when the PR was found by number / title. */
  number: number | null;
  repoFullName: string | null;
}

type Query = { number?: number; title?: string };

/** How a `pr_id` value is read: a uuid, a PR number, or part of a title. */
export function parsePrRef(value: string): { uuid: string } | Query {
  const text = value.trim();
  if (UUID_RE.test(text)) return { uuid: text };
  const num = text.match(NUMBER_RE);
  if (num) {
    const n = Number(num[1]);
    if (!Number.isSafeInteger(n) || n < 1) throw new ToolInputError(`"${value}" is not a valid PR number.`);
    return { number: n };
  }
  if (text.length < MIN_TITLE) {
    throw new ToolInputError('pr_id must be a pr_id uuid, a PR number (e.g. 15 or #15) or at least 2 characters of the PR title.');
  }
  if (text.length > MAX_TITLE) throw new ToolInputError(`A PR title search must be at most ${MAX_TITLE} characters.`);
  return { title: text };
}

/** Resolve the PR a tool call names. Throws ToolInputError (or ApiError) — never guesses. */
export async function resolvePr(deps: ToolDeps, input: PrRefArgs): Promise<ResolvedPr> {
  const ref = parsePrRef(input.pr_id);
  if ('uuid' in ref) return { prId: ref.uuid, number: null, repoFullName: null };

  const repo = input.repo?.trim() || undefined;
  const found = await deps.api.findPulls({ ...ref, repo });
  if (repo !== undefined) {
    const repos = found.repo_matches ?? [];
    if (repos.length === 0) throw new ToolInputError(`Repository "${repo}" is not in DevDigest.`);
    if (repos.length > 1) {
      throw new ToolInputError(
        `Repository "${repo}" is ambiguous: ${repos.map((r) => r.full_name).join(', ')}. Pass repo as "owner/name".`,
      );
    }
  }

  const what = describePr(ref, repo);
  if (found.matches.length === 0) {
    throw new ToolInputError(`${what} was not found among the PRs stored in DevDigest (it may not be imported yet).`);
  }
  if (found.matches.length > 1) throw new ToolInputError(ambiguousMessage(what, found));
  const m = found.matches[0]!;
  return { prId: m.id, number: m.number, repoFullName: m.repo_full_name };
}

/** "Resolved …" line for tool text output; empty when the uuid was given directly. */
export function resolvedLine(pr: ResolvedPr): string {
  return pr.number === null ? '' : `Resolved PR #${pr.number} in ${pr.repoFullName} (pr_id ${pr.prId}).`;
}

function describePr(ref: Query, repo: string | undefined): string {
  const head = ref.number !== undefined ? `PR #${ref.number}` : `A PR with "${ref.title}" in its title`;
  return repo !== undefined ? `${head} in ${repo}` : head;
}

function ambiguousMessage(what: string, found: ApiPullLookup): string {
  const count = `${found.matches.length}${found.truncated ? '+' : ''}`;
  const listed = found.matches
    .slice(0, MAX_LISTED)
    .map((m) => `- ${m.repo_full_name}#${m.number} "${m.title}" (pr_id ${m.id})`);
  if (found.matches.length > MAX_LISTED || found.truncated) listed.push('- …');
  return [`${what} is ambiguous: ${count} stored PRs match. Pass repo, or the pr_id uuid:`, ...listed].join('\n');
}
