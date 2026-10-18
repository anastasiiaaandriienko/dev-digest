import { z } from 'zod';
import { Provider } from './knowledge.js';
import { Verdict } from './findings.js';

/**
 * Platform / scaffolding DTOs owned by F1:
 *  - settings (GET/PUT /settings, POST /settings/test-connection)
 *  - repos (POST/GET /repos, refresh, delete)
 *  - pulls (GET /repos/:id/pulls, GET /pulls/:id)
 *  - context (Project Context folder)
 */

// ---- Feature → model selection ----
/** System LLM features whose model is selectable in Settings (per-workspace). */
export const FeatureModelId = z.enum([
  'onboarding',
  'review_intent',
  'risk_brief',
  'conformance',
  'conventions',
]);
export type FeatureModelId = z.infer<typeof FeatureModelId>;

/** A chosen provider + model for one feature. */
export const FeatureModelChoice = z.object({
  provider: Provider,
  model: z.string().min(1),
});
export type FeatureModelChoice = z.infer<typeof FeatureModelChoice>;

/**
 * Registry of the selectable features: stable id, display label, and the
 * built-in default used when the workspace hasn't overridden the choice. The
 * defaults MIRROR each module's constants, so behaviour is unchanged until a
 * model is explicitly picked.
 */
export interface FeatureModelDef {
  id: FeatureModelId;
  label: string;
  description: string;
  defaultProvider: Provider;
  defaultModel: string;
}
export const FEATURE_MODELS: FeatureModelDef[] = [
  {
    id: 'onboarding',
    label: 'Onboarding Tour',
    description: 'Writes the per-repo onboarding tour.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'review_intent',
    label: 'PR Review · Intent',
    description: 'Derives a PR’s intent and scope before review.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'risk_brief',
    label: 'Risk Brief',
    description: 'Assesses merge risks for a pull request.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conformance',
    label: 'Conformance',
    description: 'Checks a PR against the project spec.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conventions',
    label: 'Conventions',
    description: 'Extracts coding conventions from the repo.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4',
  },
];

// ---- Settings ----
/**
 * Non-secret prefs/config. Secrets (API keys) are NOT stored here — they go
 * through SecretsProvider (.env in MVP). Settings is a flat key/value bag,
 * surfaced as a typed object for the well-known keys.
 */
export const SettingsKnown = z.object({
  polling_interval_min: z.number().int().min(1).default(5),
  theme: z.enum(['dark', 'light']).default('dark'),
  density: z.enum(['regular', 'compact']).default('regular'),
  sync_to_folder: z.boolean().default(true),
  automatic_reviews: z.boolean().default(false),
  /** Per-feature model overrides (provider+model), keyed by FeatureModelId. */
  feature_models: z.record(FeatureModelId, FeatureModelChoice).default({}),
});
export type SettingsKnown = z.infer<typeof SettingsKnown>;

/** Full settings payload: well-known keys + arbitrary extras. */
export const Settings = SettingsKnown.passthrough();
export type Settings = z.infer<typeof Settings>;

export const SettingsUpdate = Settings.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

// ---- Connection test ----
export const ConnTestProvider = z.enum(['openai', 'anthropic', 'openrouter', 'github']);
export type ConnTestProvider = z.infer<typeof ConnTestProvider>;

export const ConnTestRequest = z.object({
  provider: ConnTestProvider,
  /** Optional API key/PAT to persist and then test (BYO key from the UI). */
  key: z.string().min(1).optional(),
});
export type ConnTestRequest = z.infer<typeof ConnTestRequest>;

export const ConnTestResult = z.object({
  provider: ConnTestProvider,
  ok: z.boolean(),
  message: z.string(),
  detail: z.unknown().optional(),
});
export type ConnTestResult = z.infer<typeof ConnTestResult>;

// ---- Secrets status (which provider keys are configured; never the values) ----
/** Boolean per provider: true ⇒ a key/PAT is stored. The value is never exposed. */
export const SecretsStatus = z.object({
  openai: z.boolean(),
  anthropic: z.boolean(),
  openrouter: z.boolean(),
  github: z.boolean(),
});
export type SecretsStatus = z.infer<typeof SecretsStatus>;

// ---- Repos ----
export const RepoInput = z.object({
  url: z.string().url(),
});
export type RepoInput = z.infer<typeof RepoInput>;

export const Repo = z.object({
  id: z.string(),
  workspace_id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  clone_path: z.string().nullable(),
  last_polled_at: z.string().nullable(),
  created_by: z.string().nullable(),
});
export type Repo = z.infer<typeof Repo>;

// ---- Pull requests ----
export const PrStatus = z.enum(['needs_review', 'reviewed', 'stale', 'open', 'closed', 'merged']);
export type PrStatus = z.infer<typeof PrStatus>;

// Findings per severity (INFO: UI token only, kept so the counts add up).
export const PrSeverityCounts = z.object({
  CRITICAL: z.number().int(),
  WARNING: z.number().int(),
  SUGGESTION: z.number().int(),
  INFO: z.number().int(),
});
export type PrSeverityCounts = z.infer<typeof PrSeverityCounts>;

// One agent's latest completed review of a PR, as counted on the PR list.
export const PrFindingsAgent = z.object({
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  review_id: z.string(),
  verdict: Verdict.nullable(),
  created_at: z.string(),
  total: z.number().int(),
  counts: PrSeverityCounts,
});
export type PrFindingsAgent = z.infer<typeof PrFindingsAgent>;

// L01 PR-list FINDINGS: the latest completed review of EACH agent (older
// reviews of the same agent are not counted); `agents` is newest first.
export const PrFindingsSummary = z.object({
  total: z.number().int(),
  counts: PrSeverityCounts,
  agents: z.array(PrFindingsAgent),
});
export type PrFindingsSummary = z.infer<typeof PrFindingsSummary>;

export const PrMeta = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  branch: z.string(),
  base: z.string(),
  head_sha: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  files_count: z.number().int(),
  status: PrStatus,
  opened_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  // Latest-review score (list endpoint only; null/absent until reviewed).
  score: z.number().int().nullish(),
  // Total USD cost of the PR's `done` runs with a known cost (L01; list endpoint
  // only). null/absent = unknown or no priced run — never shown as $0.00.
  cost_usd: z.number().nullable().optional(),
  // true when at least one `done` run has an unknown cost, so cost_usd is a
  // lower bound (L01; list endpoint only). Absent = not computed.
  cost_partial: z.boolean().optional(),
  // Findings over every agent's latest completed review (L01; list endpoint
  // only). null = no completed review; absent = not computed.
  findings_summary: PrFindingsSummary.nullable().optional(),
});
export type PrMeta = z.infer<typeof PrMeta>;

// ---- PR lookup (GET /pulls?number=&title=&repo=) — read-only, stored PRs only ----
export const PullRef = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  status: z.string(),
  repo_id: z.string(),
  repo_full_name: z.string(),
});
export type PullRef = z.infer<typeof PullRef>;

export const PullLookup = z.object({
  /** Stored PRs matching every given filter, sorted by repo then number (newest first). */
  matches: z.array(PullRef),
  /** More PRs matched than were returned. */
  truncated: z.boolean(),
  /** Repositories the `repo` filter resolved to; null when no `repo` was given. */
  repo_matches: z.array(z.object({ id: z.string(), full_name: z.string() })).nullable(),
});
export type PullLookup = z.infer<typeof PullLookup>;

export const PrFile = z.object({
  path: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  patch: z.string().nullish(),
});
export type PrFile = z.infer<typeof PrFile>;

export const PrCommit = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  committed_at: z.string().nullish(),
});
export type PrCommit = z.infer<typeof PrCommit>;

export const IssueMeta = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.string(),
});
export type IssueMeta = z.infer<typeof IssueMeta>;

export const PrDetail = PrMeta.extend({
  body: z.string().nullish(),
  files: z.array(PrFile),
  commits: z.array(PrCommit),
  linked_issue: IssueMeta.nullish(),
});
export type PrDetail = z.infer<typeof PrDetail>;

// ---- PR review (inline) comments ----
/**
 * A GitHub PR review comment anchored to a diff line. Mirrors the fields the
 * "Files changed" tab needs to render threads inline; `line` is the position in
 * the current diff (null when GitHub can no longer anchor it → `is_outdated`).
 */
export const PrReviewComment = z.object({
  id: z.number().int(),
  path: z.string(),
  line: z.number().int().nullable(),
  original_line: z.number().int().nullable(),
  side: z.enum(['LEFT', 'RIGHT']),
  body: z.string(),
  user: z.string(),
  created_at: z.string(),
  html_url: z.string(),
  in_reply_to_id: z.number().int().nullable(),
  /** GitHub couldn't anchor it to the current diff (line == null). */
  is_outdated: z.boolean(),
});
export type PrReviewComment = z.infer<typeof PrReviewComment>;

/** Body for POST /pulls/:id/comments (create one inline comment / reply). */
export const PrCommentInput = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
  body: z.string().min(1),
  /** Reply to an existing review comment thread (its comment id). */
  in_reply_to: z.number().int().optional(),
});
export type PrCommentInput = z.infer<typeof PrCommentInput>;

// ---- Project Context ----
export const SpecFile = z.object({
  path: z.string(),
  content: z.string().nullish(),
  size: z.number().int().nullish(),
  updated_at: z.string().nullish(),
});
export type SpecFile = z.infer<typeof SpecFile>;

export const IndexStatus = z.object({
  status: z.enum(['idle', 'cloning', 'parsing', 'embedding', 'done', 'error']),
  pct: z.number().min(0).max(100),
  message: z.string().nullish(),
  chunks_indexed: z.number().int().nullish(),
});
export type IndexStatus = z.infer<typeof IndexStatus>;
// ---- Project Context folder (specs/project-context-folder) ----
export const ContextTruncatedReason = z.enum(['file_limit', 'depth_limit', 'time_limit']);
export type ContextTruncatedReason = z.infer<typeof ContextTruncatedReason>;

/** One discovered doc in a list. Metadata only — never document content. */
export const ContextListItem = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  updated_at: z.string(),
});
export type ContextListItem = z.infer<typeof ContextListItem>;

/** GET /repos/:id/context?q= */
export const ContextList = z.object({
  files: z.array(ContextListItem),
  roots: z.array(z.string()),
  truncated: z.boolean(),
  truncated_reasons: z.array(ContextTruncatedReason),
});
export type ContextList = z.infer<typeof ContextList>;

/** GET /repos/:id/context/file?path= — read-only preview (redacted, capped). */
export const ContextFile = z.object({
  path: z.string(),
  content: z.string(),
  size: z.number().int().nonnegative(),
  updated_at: z.string(),
  truncated: z.boolean(),
});
export type ContextFile = z.infer<typeof ContextFile>;

/** Body of PUT /repos/:id/context/roots. */
export const ContextRootsUpdate = z.object({ roots: z.array(z.string()) });
export type ContextRootsUpdate = z.infer<typeof ContextRootsUpdate>;

/** GET|PUT /repos/:id/context/roots. */
export const ContextRoots = z.object({ roots: z.array(z.string()) });
export type ContextRoots = z.infer<typeof ContextRoots>;

export const ContextAttachmentStatus = z.enum(['ok', 'missing', 'outside_roots']);
export type ContextAttachmentStatus = z.infer<typeof ContextAttachmentStatus>;

/** One doc attached to an agent or a skill for a repo. */
export const ContextAttachment = z.object({
  id: z.string(),
  repo_id: z.string(),
  path: z.string(),
  order: z.number().int().nonnegative(),
  status: ContextAttachmentStatus,
});
export type ContextAttachment = z.infer<typeof ContextAttachment>;

/** Body of POST /agents|skills/:id/context-docs?repo_id=. */
export const ContextAttachRequest = z.object({ path: z.string().min(1) });
export type ContextAttachRequest = z.infer<typeof ContextAttachRequest>;

// Full new order of one owner's attached docs for a repo. `.max(10)` mirrors the
// server's MAX_ATTACHMENTS (server/src/modules/context/constants.ts).
export const ContextReorderRequest = z.object({
  ids: z
    .array(z.string().uuid())
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'ids must be unique' }),
});
export type ContextReorderRequest = z.infer<typeof ContextReorderRequest>;

// ---- Run request (review trigger; owned by A2, contract lives here) ----
export const RunRequest = z.object({
  agentId: z.string().optional(),
  all: z.boolean().optional(),
});
export type RunRequest = z.infer<typeof RunRequest>;

// ---- Structured API error envelope (returned by the API; UX taxonomy is FE) ----
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
