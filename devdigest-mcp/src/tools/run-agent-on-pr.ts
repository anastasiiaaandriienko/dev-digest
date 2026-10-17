import { z } from 'zod';
import type { ApiRunSummary } from '../api-schemas.js';
import { ReviewOut, reviewText, toReviewOut } from '../findings.js';
import { MAX_RUN_TIMEOUT_MS } from '../config.js';
import { ApiError, sanitizeMessage } from '../errors.js';
import { fail, ok, type ToolResult } from '../tool-result.js';
import type { ToolDeps } from './deps.js';

export const RUN_AGENT_ON_PR = 'run_agent_on_pr';

/**
 * done / failed / cancelled — the run's terminal state on the server.
 * timeout    — still running when the wait ended; it keeps going on the server.
 * poll_error — the run was started but its status could not be read (network, timeout, 429…).
 * In the last two cases the run_id is returned so get_findings can fetch the result later.
 */
const RUN_STATUSES = ['done', 'failed', 'cancelled', 'timeout', 'poll_error'] as const;
type RunStatus = (typeof RUN_STATUSES)[number];

export const runAgentInput = {
  pr_id: z.string().uuid().describe('Internal DevDigest pull-request id (uuid), not the GitHub PR number.'),
  agent_id: z.string().uuid().describe('Id of ONE agent from list_agents.'),
  timeout_seconds: z
    .number()
    .int()
    .min(10)
    .max(MAX_RUN_TIMEOUT_MS / 1000)
    .optional()
    .describe('How long to wait for the run to finish (default from DEVDIGEST_RUN_TIMEOUT_MS, 50 s).'),
};
export const runAgentOutput = {
  pr_id: z.string(),
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string().nullable(),
  status: z.enum(RUN_STATUSES),
  /** Failure / cancellation / polling error (sanitized); null when done or timed out. */
  error: z.string().nullable(),
  duration_ms: z.number().nullable(),
  cost_usd: z.number().nullable(),
  /** The finished review (verdict + findings); null unless status is done. */
  review: ReviewOut.nullable(),
};

export const runAgentConfig = {
  title: 'Run one review agent on a PR (paid LLM call)',
  description:
    'Starts a review of a PR by ONE agent (POST /pulls/:id/review), waits for that run to finish and returns its verdict and findings. ' +
    'WARNING: changes state (creates a run, review and findings) and makes a PAID LLM call — only use it when the user asked for a review. ' +
    'If the wait ends first (status timeout or poll_error) the run keeps going on the server; fetch its result later with get_findings and the returned run_id.',
  inputSchema: runAgentInput,
  outputSchema: runAgentOutput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
};

/** Called on every status poll; the MCP layer turns it into notifications/progress. */
export type ProgressFn = (progress: number, total: number, message: string) => Promise<void>;

const errorText = (err: unknown): string =>
  err instanceof ApiError ? err.message : err instanceof Error ? sanitizeMessage(err.message) : 'unknown error';

export async function runAgentOnPr(
  deps: ToolDeps,
  input: { pr_id: string; agent_id: string; timeout_seconds?: number },
  onProgress?: ProgressFn,
): Promise<ToolResult> {
  const { api, config } = deps;

  // 1. Start the run. An HTTP error means the server refused it (nothing started). A timeout or an
  //    unexpected response means the request may have reached the server, which creates and starts
  //    the run before replying — warn before a retry starts a second paid review.
  let run: { run_id: string; agent_id: string; agent_name?: string | null };
  try {
    const started = await api.startReview(input.pr_id, input.agent_id);
    const own = started.runs.find((r) => r.agent_id === input.agent_id);
    if (!own || started.runs.length !== 1) {
      return fail(new Error('DevDigest API did not return exactly one run for the requested agent'));
    }
    run = own;
  } catch (err) {
    const result = fail(err);
    if (err instanceof ApiError && (err.kind === 'timeout' || err.kind === 'invalid_response')) {
      result.content[0]!.text += ` A review run may already have started — check get_findings with pr_id ${input.pr_id} before retrying.`;
    }
    return result;
  }
  deps.logger.info(`run ${run.run_id} started for agent ${input.agent_id} on PR ${input.pr_id}`);

  // 2. From here on a paid run exists: every outcome must carry its run_id.
  const waitMs = input.timeout_seconds !== undefined ? input.timeout_seconds * 1000 : config.runTimeoutMs;
  const startedAt = deps.now();
  const deadline = startedAt + waitMs;
  let summary: ApiRunSummary | undefined;
  let status: RunStatus = 'timeout';
  let error: string | null = null;
  let review: ReviewOut | null = null;
  try {
    for (;;) {
      const runs = await api.listRuns(input.pr_id);
      summary = runs.find((r) => r.run_id === run.run_id);
      const s = summary?.status;
      if (!summary) {
        // The row is created before POST returns, so a missing row means it was deleted.
        status = 'failed';
        error = 'run not found (it may have been deleted)';
        break;
      }
      if (s === 'done' || s === 'failed' || s === 'cancelled') {
        status = s;
        error = summary.error ? sanitizeMessage(summary.error) : null;
        break;
      }
      if (s != null && s !== 'running') {
        status = 'failed'; // an unknown terminal state: report it rather than poll forever
        error = `unknown run status: ${sanitizeMessage(s)}`;
        break;
      }
      const elapsed = deps.now() - startedAt;
      await onProgress?.(Math.min(elapsed, waitMs), waitMs, `run ${run.run_id} is running (${Math.round(elapsed / 1000)} s)`).catch(() => {});
      if (deps.now() + config.pollIntervalMs > deadline) break;
      await deps.sleep(config.pollIntervalMs);
    }
    if (status === 'done') {
      const reviews = await api.listReviews(input.pr_id);
      const own = reviews.find((r) => r.run_id === run.run_id);
      review = own ? toReviewOut(own) : null;
    }
  } catch (err) {
    // A finished run whose review could not be read stays "done" (review null); otherwise poll_error.
    if (status !== 'done') status = 'poll_error';
    error = errorText(err);
  }

  const structured = {
    pr_id: input.pr_id,
    run_id: run.run_id,
    agent_id: input.agent_id,
    agent_name: run.agent_name ?? summary?.agent_name ?? null,
    status,
    error,
    duration_ms: summary?.duration_ms ?? null,
    cost_usd: summary?.cost_usd ?? null,
    review,
  };

  const later = `call get_findings with pr_id ${input.pr_id} and run_id ${run.run_id} later`;
  let text: string;
  if (status === 'done') {
    text = review
      ? `Run ${run.run_id} done.\n${reviewText(review)}`
      : `Run ${run.run_id} done, but its review could not be read${error ? ` (${error})` : ''}; ${later}.`;
  } else if (status === 'timeout') {
    text = `Run ${run.run_id} is still running after ${Math.round(waitMs / 1000)} s. It continues on the server; ${later}.`;
  } else if (status === 'poll_error') {
    text = `Run ${run.run_id} was started, but its status could not be read: ${error}. It may still finish on the server; ${later}.`;
  } else {
    text = `Run ${run.run_id} ${status}${error ? `: ${error}` : ''}.`;
  }
  return ok(text, structured);
}
