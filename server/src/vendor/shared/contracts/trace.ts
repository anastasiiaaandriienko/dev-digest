import { z } from 'zod';

/**
 * Run trace. The ENTIRE trace of one run is persisted as a SINGLE
 * jsonb document in `run_traces` (not per-row). Live events stream via SSE
 * during the run; the full log is written once on completion.
 */

export const RunEventKind = z.enum(['info', 'tool', 'result', 'error']);
export type RunEventKind = z.infer<typeof RunEventKind>;

/** A single live-log line. `t` = elapsed timestamp string (e.g. "00.31"). */
export const RunLogLine = z.object({
  t: z.string(),
  kind: RunEventKind,
  msg: z.string(),
});
export type RunLogLine = z.infer<typeof RunLogLine>;

/** SSE payload streamed on `/runs/:id/events`. */
export const RunEvent = z.object({
  runId: z.string(),
  seq: z.number().int(),
  kind: RunEventKind,
  msg: z.string(),
  t: z.string(),
  data: z.unknown().optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const ToolCall = z.object({
  tool: z.string(),
  args: z.string(),
  meta: z.string().nullish(),
  ms: z.number().int(),
});
export type ToolCall = z.infer<typeof ToolCall>;

/** One skill as applied to a run prompt (HW2 #19/#20): a run-time snapshot of
    what was sent, in prompt order — not a lookup of the skill today. */
export const AppliedSkill = z.object({
  skill_id: z.string(),
  name: z.string(),
  version: z.number().int(),
  /** 0-based position in the Skills section (agent_skills order among applied skills). */
  order: z.number().int().nonnegative(),
  /** Tokens of this skill block alone (tiktoken). */
  tokens: z.number().int().nonnegative(),
});
export type AppliedSkill = z.infer<typeof AppliedSkill>;

/** One attached project-context doc as seen at run time (paths and metadata only,
    never document text). One entry per attachment occurrence. */
export const SpecBlock = z.object({
  path: z.string(),
  source: z.enum(['agent', 'skill']),
  skill_id: z.string().nullish(),
  status: z.enum(['read', 'missing', 'skipped']),
  reason: z.string().nullish(),
  tokens: z.number().int().nonnegative().nullish(),
  truncated: z.boolean().nullish(),
});
export type SpecBlock = z.infer<typeof SpecBlock>;

/** Counts and the limits used for the project-context section of a run. */
export const SpecSummary = z.object({
  attached: z.number().int().nonnegative(),
  read: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  truncated: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  limits: z.object({
    doc_bytes: z.number().int().nonnegative(),
    doc_tokens: z.number().int().nonnegative(),
    prompt_tokens: z.number().int().nonnegative(),
    attachments: z.number().int().nonnegative(),
  }),
});
export type SpecSummary = z.infer<typeof SpecSummary>;

export const PromptAssembly = z.object({
  system: z.string(),
  skills: z.string().nullish(),
  memory: z.string().nullish(),
  specs: z.string().nullish(),
  /** Callers-of-changed-symbols digest (T1.3); null when absent. */
  callers: z.string().nullish(),
  /** Repo skeleton / map (T3); null when absent. Enables per-slot token
      attribution in the run trace. */
  repo_map: z.string().nullish(),
  /** PR author's description/body (truncated); null when absent. */
  pr_description: z.string().nullish(),
  /** AI-generated PR intent (L03), rendered data; absent when no intent. */
  intent: z.string().nullish(),
  /** Skills applied to this run, in prompt order (enabled for the agent AND
      globally). Absent in traces written before HW2 #19. */
  skill_blocks: z.array(AppliedSkill).nullish(),
  /** Tokens of the Skills section ONLY (tiktoken), not the whole prompt. null
      when no skill was applied; absent in older traces. */
  skills_tokens: z.number().int().nonnegative().nullish(),
  /** Project-context docs per attachment occurrence (paths + status, no text). */
  spec_blocks: z.array(SpecBlock).nullish(),
  /** Tokens of "## Project context
" + the specs block as sent to the LLM; null when absent. */
  specs_tokens: z.number().int().nonnegative().nullish(),
  spec_summary: SpecSummary.nullish(),
  user: z.string(),
});
export type PromptAssembly = z.infer<typeof PromptAssembly>;

export const MemoryPulled = z.object({
  pr: z.number().int().nullish(),
  text: z.string(),
});
export type MemoryPulled = z.infer<typeof MemoryPulled>;

export const RunStats = z.object({
  duration_ms: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  findings: z.number().int(),
  grounding: z.string(),
  /** Run cost in USD (L01). null = unknown; 0 = known zero (free model). Absent in
      traces written before L01 — absent means unknown, never 0. */
  cost_usd: z.number().finite().nonnegative().nullable().optional(),
});
export type RunStats = z.infer<typeof RunStats>;

/** The single-document trace stored in `run_traces.trace`. */
export const RunTrace = z.object({
  config: z.object({
    agent: z.string(),
    version: z.string().nullish(),
    provider: z.string().nullish(),
    model: z.string(),
    pr: z.number().int().nullish(),
    source: z.enum(['local', 'ci']).default('local'),
  }),
  stats: RunStats,
  prompt_assembly: PromptAssembly,
  tool_calls: z.array(ToolCall),
  raw_output: z.string(),
  memory_pulled: z.array(MemoryPulled),
  specs_read: z.array(z.string()),
  log: z.array(RunLogLine),
});
export type RunTrace = z.infer<typeof RunTrace>;

/**
 * One row of a PR's run history (every agent_runs row, any status). Surfaced on
 * the PR page so runs — including FAILED ones with their error — survive reload.
 */
export const RunSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string().nullable(), // running | done | failed | cancelled
  error: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  findings_count: z.number().int().nullable(),
  grounding: z.string().nullable(),
  ran_at: z.string().nullable(),
  // Review outcome, denormalized onto the run row at completion (the timeline
  // has no FK to the review). score = the review's 0-100 score; blockers =
  // findings that trip the agent's gate. Null on failed/cancelled runs.
  score: z.number().int().nullable(),
  blockers: z.number().int().nullable(),
  // Run cost in USD from run_traces.trace.stats.cost_usd (L01). Always present;
  // null = unknown (no trace, an old trace, or an unknown cost) — never 0.
  cost_usd: z.number().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;
