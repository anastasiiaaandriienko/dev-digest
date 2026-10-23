import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, IntentConfidence, PrBrief, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
  // L06: id of the agent eval case created from this finding (absent/null = none yet).
  eval_case_id: z.string().nullish(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/** Intent persisted for a PR (the Intent plus the pr_id it scopes). */
export const PrIntentRecord = Intent.extend({ pr_id: z.string() });
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

// ---- L03 Intent block: GET/POST /pulls/:id/intent ----

export const IntentStaleReason = z.enum(['pr_changed', 'model_changed', 'prompt_changed']);
export type IntentStaleReason = z.infer<typeof IntentStaleReason>;

/**
 * fresh   = stored intent matches the current PR input, prompt version and model.
 * stale   = at least one definite stale reason (see stale_reasons).
 * unknown = no definite reason, but the PR file data needed to compare is not
 *           loaded locally; also returned when no intent has been generated yet
 *           (then `intent` and `meta` are null).
 */
export const IntentFreshness = z.enum(['fresh', 'stale', 'unknown']);
export type IntentFreshness = z.infer<typeof IntentFreshness>;

export const IntentModelSource = z.enum(['override', 'fallback_onboarding']);
export type IntentModelSource = z.infer<typeof IntentModelSource>;

export const IntentModelInfo = z.object({
  provider: z.string(),
  model: z.string(),
  source: IntentModelSource,
});
export type IntentModelInfo = z.infer<typeof IntentModelInfo>;

export const PrIntentMeta = z.object({
  provider: z.string().nullable(),
  model: z.string().nullable(),
  prompt_version: z.string().nullable(),
  confidence: IntentConfidence.nullable(),
  generated_at: z.string(),
  head_sha: z.string().nullable(),
  input_snapshot_at: z.string().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type PrIntentMeta = z.infer<typeof PrIntentMeta>;

/**
 * Where intent context came from. Only `confirmed` sources had their content
 * read (PR fields, issues fetched from the PR's own repo, planning docs in the
 * PR diff). `unverified` = referenced but never fetched (external links, docs
 * outside the diff); `unavailable` = a fetch was attempted and failed;
 * `missing` = the field exists but is empty.
 */
export const IntentContextKind = z.enum([
  'pr_title',
  'pr_description',
  'linked_issue',
  'ticket_link',
  'plan_link',
  'link',
  'plan_doc',
]);
export type IntentContextKind = z.infer<typeof IntentContextKind>;

export const IntentContextStatus = z.enum(['confirmed', 'unverified', 'unavailable', 'missing']);
export type IntentContextStatus = z.infer<typeof IntentContextStatus>;

/** Why a source is not (fully) confirmed. Fixed codes — never provider/GitHub error text. */
export const IntentContextNote = z.enum([
  'empty',
  'truncated',
  'not_fetched',
  'not_in_diff',
  'no_patch',
  'not_found_or_no_access',
  'github_unavailable',
  'fetch_failed',
  'over_limit',
]);
export type IntentContextNote = z.infer<typeof IntentContextNote>;

export const IntentContextSource = z.object({
  kind: IntentContextKind,
  status: IntentContextStatus,
  /** '#12', a sanitized URL (no credentials/query/fragment), a repo path, or 'title' / 'description'. */
  ref: z.string(),
  /** Issue title (confirmed linked issues only). */
  title: z.string().nullish(),
  note: IntentContextNote.nullish(),
});
export type IntentContextSource = z.infer<typeof IntentContextSource>;

export const PrIntentState = z.object({
  pr_id: z.string(),
  intent: Intent.nullable(),
  meta: PrIntentMeta.nullable(),
  freshness: IntentFreshness,
  stale_reasons: z.array(IntentStaleReason),
  current_model: IntentModelInfo.nullable(),
  /** Why no model could be resolved (current_model is null). */
  model_error: z.string().nullish(),
  /** Context the stored intent was generated from; null when not recorded (no intent, or generated before L03 context). */
  context_sources: z.array(IntentContextSource).nullish(),
  /** POST only: true when this call ran the LLM, false on a cache hit. */
  computed: z.boolean().optional(),
});
export type PrIntentState = z.infer<typeof PrIntentState>;

export const IntentRunRequest = z.object({
  force: z.boolean().default(false),
});
export type IntentRunRequest = z.infer<typeof IntentRunRequest>;

/** GET/POST /pulls/:id/brief. Lives here (not in brief.ts) because this file already imports brief.ts. */
export const PrBriefState = z.object({
  pr_id: z.string(),
  brief: PrBrief.nullable(),
  freshness: IntentFreshness,
  stale_reasons: z.array(IntentStaleReason),
  model_error: z.string().nullish(),
});
export type PrBriefState = z.infer<typeof PrBriefState>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;
