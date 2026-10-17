import { z } from 'zod';

/**
 * Response shapes of the DevDigest HTTP API, limited to the fields this MCP
 * server reads. They mirror the server's published contracts
 * (`server/src/vendor/shared/contracts/*`) but are declared here on purpose:
 * the MCP server is an independent HTTP client, so it validates only what it
 * uses and ignores (strips) everything else, e.g. agent system prompts.
 */

export const ApiAgent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  provider: z.string().nullish(),
  model: z.string().nullish(),
  enabled: z.boolean(),
  strategy: z.string().nullish(),
  skill_count: z.number().int().nullish(),
});
export type ApiAgent = z.infer<typeof ApiAgent>;
export const ApiAgentList = z.array(ApiAgent);

/** POST /pulls/:id/review → `ReviewRunResponse` (reviews is always [] — runs are fire-and-forget). */
export const ApiReviewStarted = z.object({
  pr_id: z.string(),
  runs: z.array(z.object({ run_id: z.string(), agent_id: z.string(), agent_name: z.string().nullish() })),
});
export type ApiReviewStarted = z.infer<typeof ApiReviewStarted>;

/** GET /pulls/:id/runs → `RunSummary[]` (newest first). status: running | done | failed | cancelled. */
export const ApiRunSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullish(),
  agent_name: z.string().nullish(),
  model: z.string().nullish(),
  status: z.string().nullish(),
  error: z.string().nullish(),
  duration_ms: z.number().nullish(),
  findings_count: z.number().nullish(),
  score: z.number().nullish(),
  blockers: z.number().nullish(),
  cost_usd: z.number().nullish(),
});
export type ApiRunSummary = z.infer<typeof ApiRunSummary>;
export const ApiRunList = z.array(ApiRunSummary);

export const ApiFinding = z.object({
  id: z.string(),
  severity: z.string(),
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number(),
  end_line: z.number(),
  rationale: z.string().nullish(),
  suggestion: z.string().nullish(),
  confidence: z.number().nullish(),
  accepted_at: z.string().nullish(),
  dismissed_at: z.string().nullish(),
});
export type ApiFinding = z.infer<typeof ApiFinding>;

/** GET /pulls/:id/reviews → `ReviewRecord[]` (newest first). */
export const ApiReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullish(),
  run_id: z.string().nullish(),
  agent_name: z.string().nullish(),
  kind: z.string(),
  verdict: z.string().nullish(),
  summary: z.string().nullish(),
  score: z.number().nullish(),
  model: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(ApiFinding),
});
export type ApiReview = z.infer<typeof ApiReview>;
export const ApiReviewList = z.array(ApiReview);

/** GET /repos/:id/conventions → `ConventionsState`. */
export const ApiConventionsState = z.object({
  scan: z
    .object({
      status: z.string(),
      model: z.string().nullish(),
      started_at: z.string().nullish(),
      finished_at: z.string().nullish(),
    })
    .nullable(),
  candidates: z.array(
    z.object({
      id: z.string(),
      rule: z.string(),
      category: z.string(),
      status: z.string(),
      confidence: z.number().nullish(),
      evidence_path: z.string().nullish(),
      evidence_line: z.number().nullish(),
    }),
  ),
  counts: z.object({ pending: z.number(), accepted: z.number(), rejected: z.number() }),
  source: z.object({ repo_full_name: z.string(), ref: z.string() }),
});
export type ApiConventionsState = z.infer<typeof ApiConventionsState>;
