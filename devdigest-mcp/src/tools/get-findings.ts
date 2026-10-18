import { z } from 'zod/v4';
import type { ApiReview } from '../api-schemas.js';
import { ReviewOut, reviewText, toReviewOut } from '../findings.js';
import { fail, ok, type ToolResult } from '../tool-result.js';
import type { ToolDeps } from './deps.js';
import { prIdField, repoField, resolvePr, resolvedLine, type PrRefArgs } from './pr-ref.js';

export const GET_FINDINGS = 'get_findings';

/** Most reviews returned when all_runs is set; more set `truncated`. */
const MAX_REVIEWS = 50;

/** Exactly three fields, in this order; unknown keys are rejected (strict). */
export const getFindingsInput = z.strictObject({
  pr_id: prIdField,
  repo: repoField,
  all_runs: z.boolean().default(false).describe('If true, return findings from all runs, not just the latest per agent'),
});
export const getFindingsOutput = {
  pr_id: z.string(),
  selection: z.enum(['latest_per_agent', 'all_runs']),
  /** More reviews matched than were returned (all_runs only). */
  truncated: z.boolean(),
  /** Findings across ALL matching reviews, before the review and per-review caps. */
  total_findings: z.number(),
  reviews: z.array(ReviewOut),
};

export const getFindingsConfig = {
  description:
    'Get the latest review verdict and findings for a pull request, grouped by agent. Each review includes its findings ' +
    'nested inside. By default returns only the latest run per agent.',
  inputSchema: getFindingsInput,
  outputSchema: getFindingsOutput,
  annotations: { readOnlyHint: true },
};

/** Completed reviews (kind 'review'), newest first; ties broken by id. */
function newestFirst(reviews: ApiReview[]): ApiReview[] {
  return reviews
    .filter((r) => r.kind === 'review')
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || (a.id < b.id ? 1 : -1));
}

/** Newest review of kind 'review' per agent. */
function latestPerAgent(reviews: ApiReview[]): ApiReview[] {
  const seen = new Set<string>();
  return newestFirst(reviews).filter((r) => {
    const key = r.agent_id ?? '';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getFindings(deps: ToolDeps, input: PrRefArgs & { all_runs?: boolean }): Promise<ToolResult> {
  try {
    const pr = await resolvePr(deps, input);
    const all = await deps.api.listReviews(pr.prId);
    const allRuns = input.all_runs === true;
    const matching = allRuns ? newestFirst(all) : latestPerAgent(all);
    const truncated = allRuns && matching.length > MAX_REVIEWS;
    const totalFindings = matching.reduce((n, r) => n + r.findings.length, 0);
    const reviews = matching.slice(0, MAX_REVIEWS).map(toReviewOut);

    const lines: string[] = [];
    const resolved = resolvedLine(pr);
    if (resolved) lines.push(resolved);
    if (reviews.length > 0) lines.push(`Total findings: ${totalFindings}`);
    lines.push(reviews.length > 0 ? reviews.map(reviewText).join('\n\n') : 'No completed reviews found for this PR.');
    if (truncated) lines.push(`Only the newest ${MAX_REVIEWS} reviews are listed.`);
    return ok(lines.join('\n'), {
      pr_id: pr.prId,
      selection: allRuns ? 'all_runs' : 'latest_per_agent',
      truncated,
      total_findings: totalFindings,
      reviews,
    });
  } catch (err) {
    return fail(err);
  }
}
