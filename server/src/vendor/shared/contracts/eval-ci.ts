import { z } from 'zod';
import { Verdict, Finding, Severity, FindingCategory } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance, Provider, CiFailOn, ReviewStrategy } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

// L07-CI:BEGIN — Export to CI + CI Runs (specs/export-to-ci.md §6.2). This block
// is byte-identical in the server and client vendored copies (line endings aside).

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio WRITES this shape to `.devdigest/agents/<slug>.yaml`; the
 * agent-runner READS it. Keeping one Zod schema for both ends guarantees the
 * formats never drift. `skills` are slugs resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  /** The studio agent's id: proves which agent owns a manifest found in a repo (§8). */
  agent_id: z.string().min(1).nullish(),
  /** Agent version at export time (shown as the workflow version). */
  version: z.number().int().nonnegative().nullish(),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** `pull_request` event types the generated workflow may trigger on (AC-CI-35). */
export const CiTrigger = z.enum(['opened', 'synchronize', 'reopened']);
export type CiTrigger = z.infer<typeof CiTrigger>;

/** How the runner posts its result (`DEVDIGEST_POST_AS`). */
export const CiPostAs = z.enum(['github_review', 'pr_comment', 'none']);
export type CiPostAs = z.infer<typeof CiPostAs>;

/** Request body for preview, `POST /agents/:id/export-ci` and its zip variant. */
export const CiExportInput = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'expected owner/name'),
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: CiPostAs.default('pr_comment'),
  triggers: z.array(CiTrigger).min(1).default(['opened', 'synchronize', 'reopened']),
  /** Base branch; absent = the target repo's default branch (AC-CI-80). */
  base: z.string().min(1).optional(),
  /** Edited files from Preview; only the workflow file is honoured (AC-CI-07, 83). */
  files: z.array(CiFile).optional(),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** Response of `POST /agents/:id/ci/preview`. */
export const CiPreview = z.object({ files: z.array(CiFile) });
export type CiPreview = z.infer<typeof CiPreview>;

/** pending = export PR opened; active = ≥1 ingested run; error = last sync failed (auth/404). */
export const CiInstallationStatus = z.enum(['pending', 'active', 'error']);
export type CiInstallationStatus = z.infer<typeof CiInstallationStatus>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
  status: CiInstallationStatus,
  /** Agent version at export time ("workflow version"). */
  agent_version: z.number().int().nullable(),
  /** The export PR on `devdigest/ci`; null for a zip export. */
  pr_url: z.string().nullable(),
  updated_at: z.string(),
  /** When the last automatic sync claimed this installation (TA4). */
  last_synced_at: z.string().nullable(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** An installation as listed on the CI tab and in the wizard (G4). */
export const CiInstallationView = CiInstallation.extend({
  agent_name: z.string(),
  last_run_status: z.string().nullable(),
  last_run_at: z.string().nullable(),
});
export type CiInstallationView = z.infer<typeof CiInstallationView>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** Verdict shown on CI Runs: gate triggered → blocked, artifact → passed, no artifact → failed. */
export const CiRunVerdict = z.enum(['blocked', 'passed', 'failed']);
export type CiRunVerdict = z.infer<typeof CiRunVerdict>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
  repo: z.string().nullish(),
  commit_sha: z.string().nullish(),
  verdict: CiRunVerdict.nullish(),
  agent_run_id: z.string().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI workflow (`devdigest-result.json`),
 * pulled back by the studio's sync. Untrusted on ingest: numbers must be ≥ 0.
 * The L07 fields are nullish so artifacts of older runner bundles still validate.
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative().nullish(),
  warning: z.number().int().nonnegative().nullish(),
  suggestion: z.number().int().nonnegative().nullish(),
  cost_usd: z.number().nonnegative().nullable(),
  duration_ms: z.number().int().nonnegative().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nonnegative().nullish(),
  model: z.string().nullish(),
  manifest_version: z.number().int().nonnegative().nullish(),
  gate_triggered: z.boolean().nullish(),
  blockers: z.number().int().nonnegative().nullish(),
  /** Manifest skill slugs (G3). */
  skills: z.array(z.string()).nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

/** Body of `POST /ci/runs/sync`. */
export const CiSyncInput = z.object({
  mode: z.enum(['auto', 'manual']),
  installation_id: z.string().uuid().optional(),
});
export type CiSyncInput = z.infer<typeof CiSyncInput>;

/** Result of `POST /ci/runs/sync`. */
export const CiSyncResult = z.object({
  ingested: z.number().int().nonnegative(),
  throttled: z.number().int().nonnegative(),
  skipped: z.array(
    z.object({
      installation_id: z.string(),
      github_run_id: z.number().int().nullable(),
      reason: z.string(),
    }),
  ),
  errors: z.array(
    z.object({
      installation_id: z.string(),
      repo: z.string(),
      message: z.string(),
    }),
  ),
});
export type CiSyncResult = z.infer<typeof CiSyncResult>;

/** `error.code` of the ci endpoints' 409 / bundle errors (§6.1). */
export const CiErrorCode = z.enum([
  'ci_repo_has_agent',
  'ci_manifest_conflict',
  'ci_file_conflict',
  'ci_concurrent_change',
  'ci_pr_base_mismatch',
  'ci_runner_bundle_missing',
]);
export type CiErrorCode = z.infer<typeof CiErrorCode>;

// L07-CI:END

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;

// L06-EVAL:BEGIN — agent eval pipeline (specs/eval-pipeline.md §6.1).
// This block is byte-identical in the server and client vendor copies; verify:l06 checks it.
// Additive only: the older Eval* shapes above are kept unchanged.

/** Label of an agent eval case: accepted finding → must_find, dismissed finding → must_not_flag. */
export const EvalCaseKind = z.enum(['must_find', 'must_not_flag']);
export type EvalCaseKind = z.infer<typeof EvalCaseKind>;

/** The frozen expectation of a case: the location the agent must (not) flag. */
export const EvalExpectation = z
  .object({
    kind: EvalCaseKind,
    file: z.string().min(1),
    start_line: z.number().int().min(1),
    end_line: z.number().int().min(1),
    severity: Severity,
    category: FindingCategory,
    title: z.string(),
  })
  .refine((e) => e.end_line >= e.start_line, { message: 'end_line must be >= start_line', path: ['end_line'] });
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/** Frozen PR metadata + provenance of a case (stored in `eval_cases.input_meta`). */
export const EvalCaseMeta = z.object({
  pr_number: z.number().int(),
  pr_title: z.string(),
  pr_body: z.string().nullable(),
  repo: z.string(),
  base: z.string(),
  head_sha: z.string(),
  source_review_id: z.string(),
  source_agent_id: z.string(),
  source_agent_version: z.number().int().nullable(),
  decided_at: z.string(),
  diff_stats: z.object({
    files: z.number().int(),
    additions: z.number().int(),
    deletions: z.number().int(),
  }),
});
export type EvalCaseMeta = z.infer<typeof EvalCaseMeta>;

/** Verdict of one case in one run (must_find: tp/fn; must_not_flag: pass/fail; engine failure: error). */
export const EvalCaseOutcome = z.enum(['tp', 'fn', 'pass', 'fail', 'error']);
export type EvalCaseOutcome = z.infer<typeof EvalCaseOutcome>;

export const AgentEvalCase = z.object({
  id: z.string(),
  agent_id: z.string(),
  name: z.string(),
  kind: EvalCaseKind,
  notes: z.string().nullable(),
  expected: EvalExpectation,
  meta: EvalCaseMeta,
  input_hash: z.string(),
  created_at: z.string().nullable(),
  source_finding_id: z.string().nullable(),
  last_result: z
    .object({ suite_run_id: z.string(), outcome: EvalCaseOutcome, ran_at: z.string() })
    .nullable(),
});
export type AgentEvalCase = z.infer<typeof AgentEvalCase>;

/** Body of `POST /findings/:id/eval-case`. The label is derived on the server, never sent. */
export const CreateEvalCaseFromFinding = z
  .object({
    name: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();
export type CreateEvalCaseFromFinding = z.infer<typeof CreateEvalCaseFromFinding>;

/** Body of `POST /agents/:id/eval-runs`: always runs the agent's current version. */
export const StartEvalRunInput = z.object({}).strict();
export type StartEvalRunInput = z.infer<typeof StartEvalRunInput>;

export const EvalExcludedInput = z.enum(['repo_intel', 'intent', 'project_context', 'memory', 'conventions']);
export type EvalExcludedInput = z.infer<typeof EvalExcludedInput>;

/** Everything a run fed to the engine, frozen at run start (skills with their bodies). */
export const EvalConfigSnapshot = z.object({
  provider: Provider,
  model: z.string(),
  strategy: ReviewStrategy,
  system_prompt: z.string(),
  agent_version: z.number().int(),
  skills: z.array(
    z.object({ id: z.string(), name: z.string(), version: z.number().int(), body: z.string() }),
  ),
  excluded: z.array(EvalExcludedInput),
});
export type EvalConfigSnapshot = z.infer<typeof EvalConfigSnapshot>;

/** Why an unmatched kept finding is a false positive (closed world, spec §8.4). */
export const EvalFpReason = z.enum(['too_wide', 'duplicate', 'negative_hit', 'unlabeled']);
export type EvalFpReason = z.infer<typeof EvalFpReason>;

export const EvalCounts = z.object({
  cases_total: z.number().int(),
  cases_passed: z.number().int(),
  tp: z.number().int(),
  fn: z.number().int(),
  fp: z.number().int(),
  fp_by_reason: z.object({
    too_wide: z.number().int(),
    duplicate: z.number().int(),
    negative_hit: z.number().int(),
    unlabeled: z.number().int(),
  }),
  kept: z.number().int(),
  raw: z.number().int(),
  valid_citations: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
});
export type EvalCounts = z.infer<typeof EvalCounts>;

export const AgentEvalRunStatus = z.enum(['running', 'done', 'failed']);
export type AgentEvalRunStatus = z.infer<typeof AgentEvalRunStatus>;

/** One `POST /agents/:id/eval-runs`. Metrics are null when undefined or the run is not done. */
export const AgentEvalRun = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_version: z.number().int(),
  prompt_sha: z.string(),
  status: AgentEvalRunStatus,
  error: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
  counts: EvalCounts.nullable(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
});
export type AgentEvalRun = z.infer<typeof AgentEvalRun>;

/** Per-case result of a run (stored in `eval_runs.actual_output` + columns). */
export const EvalCaseResult = z.object({
  case_id: z.string(),
  case_name: z.string(),
  kind: EvalCaseKind,
  outcome: EvalCaseOutcome,
  pass: z.boolean(),
  expected: EvalExpectation,
  matched_finding: Finding.nullable(),
  overlapping: z.array(Finding),
  group_fp: z.array(z.object({ finding: Finding, reason: EvalFpReason })),
  dropped: z.array(z.object({ finding: Finding, reason: z.string() })),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResult>;

/** A case result as returned by `GET /eval-runs/:id`: plus the engine error of its group, if any. */
export const EvalCaseRunResult = EvalCaseResult.extend({
  error: z.string().nullable(),
});
export type EvalCaseRunResult = z.infer<typeof EvalCaseRunResult>;

/** `GET /eval-runs/:id`. `config` is null only for a row whose snapshot no longer parses. */
export const AgentEvalRunDetail = AgentEvalRun.extend({
  config: EvalConfigSnapshot.nullable(),
  results: z.array(EvalCaseRunResult),
});
export type AgentEvalRunDetail = z.infer<typeof AgentEvalRunDetail>;

export const EvalCaseChange = z.enum(['fixed', 'regressed', 'unchanged', 'only_base', 'only_head']);
export type EvalCaseChange = z.infer<typeof EvalCaseChange>;

/** The comparable part of a run config: everything but the prompt text and skill bodies. */
export const EvalConfigSummary = z.object({
  provider: Provider,
  model: z.string(),
  strategy: ReviewStrategy,
  agent_version: z.number().int(),
  prompt_sha: z.string(),
  skills: z.array(z.object({ id: z.string(), name: z.string(), version: z.number().int(), body_sha: z.string() })),
});
export type EvalConfigSummary = z.infer<typeof EvalConfigSummary>;

/** One skill difference between two runs (matched by skill id). */
export const EvalSkillChange = z.object({
  id: z.string(),
  name: z.string(),
  change: z.enum(['added', 'removed', 'changed']),
  base_version: z.number().int().nullable(),
  head_version: z.number().int().nullable(),
});
export type EvalSkillChange = z.infer<typeof EvalSkillChange>;

/** `GET /eval-runs/compare?base=&head=` — two runs of the same agent. */
export const EvalRunComparison = z.object({
  base: AgentEvalRun,
  head: AgentEvalRun,
  base_prompt: z.string(),
  head_prompt: z.string(),
  config: z.object({ base: EvalConfigSummary.nullable(), head: EvalConfigSummary.nullable() }),
  skill_changes: z.array(EvalSkillChange),
  delta: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
    cost_usd: z.number().nullable(),
  }),
  prompt_changed: z.boolean(),
  config_changes: z.array(z.enum(['model', 'provider', 'strategy', 'skills'])),
  same_case_set: z.boolean(),
  cases: z.array(
    z.object({
      case_id: z.string(),
      case_name: z.string(),
      kind: EvalCaseKind,
      base: EvalCaseOutcome.nullable(),
      head: EvalCaseOutcome.nullable(),
      change: EvalCaseChange,
    }),
  ),
});
export type EvalRunComparison = z.infer<typeof EvalRunComparison>;

/** Stable `error.code` values of the eval endpoints (the client maps them to copy). */
export const EvalErrorCode = z.enum([
  'finding_not_decided',
  'eval_case_exists',
  'duplicate_location',
  'conflicting_label',
  'finding_has_no_agent',
  'location_not_in_diff',
  'range_too_wide',
  'diff_unavailable',
  'diff_too_large',
  'eval_run_in_progress',
  'no_eval_cases',
  'too_many_cases',
  'different_agents',
  'run_not_done',
]);
export type EvalErrorCode = z.infer<typeof EvalErrorCode>;
// L06-EVAL:END
