import { z } from 'zod/v4';
import type { ApiRunSummary } from '../api-schemas.js';
import { ReviewOut, reviewText, toReviewOut } from '../findings.js';
import { ApiError, sanitizeMessage } from '../errors.js';
import { fail, ok, type ToolResult } from '../tool-result.js';
import type { ToolDeps } from './deps.js';
import { prIdField, repoField, resolvePr, type PrRefArgs } from './pr-ref.js';

export const RUN_AGENT_ON_PR = 'run_agent_on_pr';

/**
 * done / failed / cancelled — the run's terminal state on the server.
 * timeout    — still running when the wait ended; it keeps going on the server.
 * poll_error — the run was started but its status could not be read (network, timeout, 429…).
 * In the last two cases the run_id is returned; get_findings with all_runs lists that run's review once it exists.
 */
const RUN_STATUSES = ['done', 'failed', 'cancelled', 'timeout', 'poll_error'] as const;
type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Exactly three fields, in this order; unknown keys are rejected (strict). The PR is resolved
 * BEFORE anything paid starts. The wait comes from DEVDIGEST_RUN_TIMEOUT_MS (default 50 s).
 */
export const runAgentInput = z.strictObject({
  pr_id: prIdField,
  repo: repoField,
  agent_id: z
    .string()
    .describe(
      "Agent ID from list_agents, e.g. 'agent-458'. Always a specific agent — to run all agents call this tool once per agent.",
    ),
});
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

// Starts a PAID LLM review and writes a run / review / findings. openWorldHint is left at its MCP
// default (true); only explicit hints are rendered as badges by the Inspector.
export const runAgentConfig = {
  description: 'Run a review agent on a pull request and return findings.',
  inputSchema: runAgentInput,
  outputSchema: runAgentOutput,
  annotations: { readOnlyHint: false, destructiveHint: false },
};

/** Called on every status poll; the MCP layer turns it into notifications/progress. */
export type ProgressFn = (progress: number, total: number, message: string) => Promise<void>;

const errorText = (err: unknown): string =>
  err instanceof ApiError ? err.message : err instanceof Error ? sanitizeMessage(err.message) : 'unknown error';

export async function runAgentOnPr(
  deps: ToolDeps,
  input: PrRefArgs & { agent_id: string },
  onProgress?: ProgressFn,
): Promise<ToolResult> {
  const { api, config } = deps;

  // 0. Resolve the PR first: an unknown or ambiguous PR must never start a paid run.
  let prId: string;
  try {
    prId = (await resolvePr(deps, input)).prId;
  } catch (err) {
    return fail(err);
  }

  // 1. Start the run. An HTTP error means the server refused it (nothing started). A timeout or an
  //    unexpected response means the request may have reached the server, which creates and starts
  //    the run before replying — warn before a retry starts a second paid review.
  let run: { run_id: string; agent_id: string; agent_name?: string | null };
  try {
    const started = await api.startReview(prId, input.agent_id);
    const own = started.runs.find((r) => r.agent_id === input.agent_id);
    if (!own || started.runs.length !== 1) {
      return fail(new Error('DevDigest API did not return exactly one run for the requested agent'));
    }
    run = own;
  } catch (err) {
    const result = fail(err);
    if (err instanceof ApiError && (err.kind === 'timeout' || err.kind === 'invalid_response')) {
      result.content[0]!.text += ` A review run may already have started — check get_findings with pr_id ${prId} before retrying.`;
    }
    return result;
  }
  deps.logger.info(`run ${run.run_id} started for agent ${input.agent_id} on PR ${prId}`);

  // 2. From here on a paid run exists: every outcome must carry its run_id.
  const waitMs = config.runTimeoutMs;
  const startedAt = deps.now();
  const deadline = startedAt + waitMs;
  let summary: ApiRunSummary | undefined;
  let status: RunStatus = 'timeout';
  let error: string | null = null;
  let review: ReviewOut | null = null;
  try {
    for (;;) {
      const runs = await api.listRuns(prId);
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
      const reviews = await api.listReviews(prId);
      const own = reviews.find((r) => r.run_id === run.run_id);
      review = own ? toReviewOut(own) : null;
    }
  } catch (err) {
    // A finished run whose review could not be read stays "done" (review null); otherwise poll_error.
    if (status !== 'done') status = 'poll_error';
    error = errorText(err);
  }

  const structured = {
    pr_id: prId,
    run_id: run.run_id,
    agent_id: input.agent_id,
    agent_name: run.agent_name ?? summary?.agent_name ?? null,
    status,
    error,
    duration_ms: summary?.duration_ms ?? null,
    cost_usd: summary?.cost_usd ?? null,
    review,
  };

  const later = `call get_findings with pr_id ${prId} and all_runs=true later (run ${run.run_id})`;
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
