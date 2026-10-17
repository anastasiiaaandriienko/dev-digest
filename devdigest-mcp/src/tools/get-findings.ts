import { z } from 'zod';
import type { ApiReview } from '../api-schemas.js';
import { ReviewOut, reviewText, toReviewOut } from '../findings.js';
import { fail, ok, type ToolResult } from '../tool-result.js';
import type { ToolDeps } from './deps.js';

export const GET_FINDINGS = 'get_findings';

export const getFindingsInput = {
  pr_id: z.string().uuid().describe('Internal DevDigest pull-request id (uuid), not the GitHub PR number.'),
  run_id: z.string().uuid().optional().describe('Return the review produced by this run.'),
  agent_id: z.string().uuid().optional().describe('Return the latest review of this agent.'),
};
export const getFindingsOutput = {
  pr_id: z.string(),
  selection: z.enum(['run', 'agent', 'latest_per_agent']),
  /** Set when a run_id was given but that run has no review (still running, failed or cancelled). */
  run_status: z.string().nullable(),
  reviews: z.array(ReviewOut),
};

export const getFindingsConfig = {
  title: 'Get review findings for a PR',
  description:
    'Returns the verdict and findings of reviews that already ran on a PR (GET /pulls/:id/reviews). ' +
    'Pick one run (run_id), the latest review of one agent (agent_id), or by default the latest review of each agent. ' +
    'Read-only: never starts a review.',
  inputSchema: getFindingsInput,
  outputSchema: getFindingsOutput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

/** Newest review of kind 'review' per agent (reviews come newest first; ties broken by id). */
function latestPerAgent(reviews: ApiReview[]): ApiReview[] {
  const sorted = reviews
    .filter((r) => r.kind === 'review')
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || (a.id < b.id ? 1 : -1));
  const seen = new Set<string>();
  return sorted.filter((r) => {
    const key = r.agent_id ?? '';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getFindings(
  deps: ToolDeps,
  input: { pr_id: string; run_id?: string; agent_id?: string },
): Promise<ToolResult> {
  try {
    const all = await deps.api.listReviews(input.pr_id);
    let selection: 'run' | 'agent' | 'latest_per_agent';
    let picked: ApiReview[];
    let runStatus: string | null = null;
    if (input.run_id) {
      selection = 'run';
      picked = all.filter((r) => r.run_id === input.run_id);
      if (picked.length === 0) {
        const runs = await deps.api.listRuns(input.pr_id);
        runStatus = runs.find((r) => r.run_id === input.run_id)?.status ?? 'not_found';
      }
    } else if (input.agent_id) {
      selection = 'agent';
      picked = latestPerAgent(all.filter((r) => r.agent_id === input.agent_id));
    } else {
      selection = 'latest_per_agent';
      picked = latestPerAgent(all);
    }
    const reviews = picked.map(toReviewOut);
    let text: string;
    if (reviews.length > 0) text = reviews.map(reviewText).join('\n\n');
    else if (runStatus) text = `No review for run ${input.run_id} (run status: ${runStatus}).`;
    else text = 'No completed reviews found for this PR.';
    return ok(text, { pr_id: input.pr_id, selection, run_status: runStatus, reviews });
  } catch (err) {
    return fail(err);
  }
}
