import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

// `imported` = uploaded as a .md / .zip file (Skills Lab "Import from file").
export const SkillSource = z.enum(['manual', 'imported', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
  // Number of agents in the workspace this skill is linked to (agent_skills).
  agent_count: z.number().int().nonnegative(),
});
export type Skill = z.infer<typeof Skill>;

// POST /skills — a new skill starts at version 1.
export const SkillCreate = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''),
  type: SkillType,
  source: SkillSource.default('manual'),
  body: z.string().min(1).max(200_000),
  enabled: z.boolean().default(true),
  evidence_files: z.array(z.string().max(500)).max(100).nullish(),
});
export type SkillCreate = z.infer<typeof SkillCreate>;

// PUT /skills/:id — partial; only a changed `body` creates a new version.
export const SkillUpdate = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000),
    type: SkillType,
    body: z.string().min(1).max(200_000),
    enabled: z.boolean(),
    evidence_files: z.array(z.string().max(500)).max(100).nullable(),
  })
  .partial()
  .refine((p) => Object.values(p).some((v) => v !== undefined), {
    message: 'Provide at least one field to update',
  });
export type SkillUpdate = z.infer<typeof SkillUpdate>;

// GET /skills/:id/versions — one immutable body snapshot (newest first).
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int().positive(),
  body: z.string(),
  created_at: z.string(),
  // true for the snapshot of the skill's current version.
  current: z.boolean(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

// POST /skills/:id/versions/:version/restore — the old body becomes a NEW
// version; `restored: false` = no-op (that body is already current).
export const SkillRestoreResult = z.object({
  skill: Skill,
  restored: z.boolean(),
  restored_from: z.number().int().positive(),
});
export type SkillRestoreResult = z.infer<typeof SkillRestoreResult>;

// ---- Skill import from a .md / .zip file ----
// The rules below are shared: the server enforces them (preview + import), the
// client runs the same checks live while the user edits the preview.

export const SKILL_IMPORT_LIMITS = {
  /** Size of the uploaded .md / .zip file itself. */
  maxUploadBytes: 2 * 1024 * 1024,
  /** Entries in a .zip (directories included). */
  maxEntries: 50,
  /** Uncompressed size of one .md (file or archive entry). */
  maxEntryBytes: 512 * 1024,
  /** Uncompressed size of all archive entries together. */
  maxTotalBytes: 5 * 1024 * 1024,
  /** Uncompressed / compressed, per entry (zip-bomb guard). */
  maxCompressionRatio: 100,
  /** Skills created by one import. */
  maxItems: 50,
} as const;

/** Imported skill names: lowercase kebab-case, e.g. `api-breaking-changes`. */
export const SKILL_IMPORT_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/;

// C0/C1 controls (tab and newlines allowed) and bidi overrides ("Trojan Source").
const UNSAFE_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;

const EXECUTABLE_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/<\s*script\b/i, '<script> tag'],
  [/<\s*(?:iframe|frame|frameset|object|embed|applet)\b/i, 'embedded frame or object'],
  [/<\s*meta\b[^>]*http-equiv/i, '<meta http-equiv>'],
  [/<[a-z][^>]*[\s/]on[a-z]+\s*=/i, 'inline event handler (on…=)'],
  [/\b(?:javascript|vbscript)\s*:/i, 'script URL'],
  [/\bdata\s*:\s*text\/html/i, 'data:text/html URL'],
];

/** Markdown without fenced / inline code: a rule may *mention* `<script>` in code. */
function proseOnly(md: string): string {
  return md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
}

/** What makes `text` executable (HTML/script outside code spans), or null. */
export function findExecutableContent(text: string): string | null {
  const prose = proseOnly(text);
  for (const [re, what] of EXECUTABLE_PATTERNS) if (re.test(prose)) return what;
  return null;
}

const safeText = (s: string, ctx: z.RefinementCtx) => {
  if (UNSAFE_CHARS_RE.test(s)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Contains control or bidi characters' });
  const exec = findExecutableContent(s);
  if (exec) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Executable content is not allowed (${exec}); put examples in code spans` });
};

/** One skill as it will be created by an import (after the user's edits). */
export const SkillImportItem = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(120)
    .regex(SKILL_IMPORT_NAME_RE, 'Use lowercase letters, digits and single hyphens (e.g. api-breaking-changes)'),
  description: z.string().trim().max(2000).default('').superRefine(safeText),
  type: SkillType,
  body: z
    .string()
    .max(200_000)
    .refine((b) => b.trim().length > 0, 'Body is empty')
    .superRefine(safeText),
});
export type SkillImportItem = z.infer<typeof SkillImportItem>;

export const SkillImportField = z.enum(['name', 'description', 'type', 'body']);
export type SkillImportField = z.infer<typeof SkillImportField>;

export const SkillImportIssue = z.object({ field: SkillImportField, message: z.string() });
export type SkillImportIssue = z.infer<typeof SkillImportIssue>;

/** Field-level problems of an item under the shared rules ([] = importable). */
export function skillImportIssues(item: { name: string; description: string; type: string; body: string }): SkillImportIssue[] {
  const res = SkillImportItem.safeParse(item);
  if (res.success) return [];
  return res.error.issues.map((i) => ({
    field: SkillImportField.catch('body').parse(i.path[0]),
    message: i.message,
  }));
}

// POST /skills/import/preview — parse an uploaded file; nothing is saved.
export const SkillImportFileRequest = z.object({
  filename: z.string().trim().min(1).max(255),
  content_base64: z
    .string()
    .min(1)
    .max(Math.ceil(SKILL_IMPORT_LIMITS.maxUploadBytes / 3) * 4),
});
export type SkillImportFileRequest = z.infer<typeof SkillImportFileRequest>;

/** One skill found in the file, as proposed (editable before the import). */
export const SkillImportCandidate = z.object({
  /** The .md file name, or the entry path inside the .zip. */
  path: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  /** Problems found by the server, incl. name already taken in the workspace. */
  issues: z.array(SkillImportIssue),
});
export type SkillImportCandidate = z.infer<typeof SkillImportCandidate>;

export const SkillImportPreview = z.object({
  filename: z.string(),
  format: z.enum(['md', 'zip']),
  items: z.array(SkillImportCandidate),
  /** Archive metadata entries that were ignored (directories, __MACOSX/, .DS_Store). */
  skipped: z.array(z.string()),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

// POST /skills/import — create the reviewed items (source `imported`, disabled).
// A name already used in the workspace (or twice in the request) → 409.
export const SkillImportRequest = z.object({
  items: z
    .array(SkillImportItem)
    .min(1)
    .max(SKILL_IMPORT_LIMITS.maxItems)
    .refine((items) => items.reduce((n, i) => n + i.body.length, 0) <= SKILL_IMPORT_LIMITS.maxTotalBytes, {
      message: `Skills in one import may total at most ${SKILL_IMPORT_LIMITS.maxTotalBytes} characters`,
    }),
});
export type SkillImportRequest = z.infer<typeof SkillImportRequest>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions Extractor (scan a repo → candidate rules → repo-conventions skill) ----
export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'error_handling',
  'types',
  'testing',
  'imports',
  'style',
  'api',
  'other',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/** pending = not decided yet; rejected candidates are kept so a rescan never brings them back. */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

export const ConventionCandidate = z.object({
  id: z.string(),
  repo_id: z.string().nullable(),
  rule: z.string(),
  category: ConventionCategory,
  /** Repo-relative file + 1-based line the rule was grounded on; the snippet is read from that file. */
  evidence_path: z.string().nullable(),
  evidence_line: z.number().int().positive().nullable(),
  evidence_snippet: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  status: ConventionStatus,
  /** = status === 'accepted' (kept for older readers). */
  accepted: z.boolean(),
  scan_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

export const ConventionScanStatus = z.enum(['running', 'done', 'failed']);
export type ConventionScanStatus = z.infer<typeof ConventionScanStatus>;

/** One extraction run: model used, files sampled, usage, and why it failed (if it did). */
export const ConventionScan = z.object({
  id: z.string(),
  repo_id: z.string(),
  status: ConventionScanStatus,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  sample_files: z.array(z.string()),
  candidates_found: z.number().int().nullable(),
  candidates_added: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  error: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

// POST /repos/:id/conventions/extract — `rescan: false` = first "Run Scan".
export const ConventionScanRequest = z.object({ rescan: z.boolean().default(false) });
export type ConventionScanRequest = z.infer<typeof ConventionScanRequest>;

// GET /repos/:id/conventions — latest scan + candidates (rejected only on request).
export const ConventionsState = z.object({
  scan: ConventionScan.nullable(),
  candidates: z.array(ConventionCandidate),
  counts: z.object({
    pending: z.number().int(),
    accepted: z.number().int(),
    rejected: z.number().int(),
  }),
});
export type ConventionsState = z.infer<typeof ConventionsState>;

// PATCH /conventions/:id — Accept / Reject / back to pending, and inline edit of rule + category.
export const ConventionUpdate = z
  .object({
    status: ConventionStatus,
    rule: z.string().trim().min(1).max(300).superRefine(safeText),
    category: ConventionCategory,
  })
  .partial()
  .refine((p) => Object.values(p).some((v) => v !== undefined), {
    message: 'Provide at least one field to update',
  });
export type ConventionUpdate = z.infer<typeof ConventionUpdate>;

// GET /repos/:id/conventions/skill-draft — built from ACCEPTED candidates only.
export const ConventionSkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  evidence_files: z.array(z.string()),
  convention_ids: z.array(z.string()),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

// POST /repos/:id/conventions/skill — the reviewed / edited draft; name taken → 409.
export const ConventionSkillCreate = SkillImportItem.extend({
  type: SkillType.default('convention'),
  enabled: z.boolean().default(true),
  /** Optional: also attach the new skill to this agent (enabled, last in its prompt). */
  agent_id: z.string().uuid().nullish(),
});
export type ConventionSkillCreate = z.infer<typeof ConventionSkillCreate>;

export const ConventionSkillResult = z.object({
  skill: Skill,
  attached_agent_id: z.string().nullable(),
});
export type ConventionSkillResult = z.infer<typeof ConventionSkillResult>;

// ---- Agents ----
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a CI review should BLOCK (REQUEST_CHANGES + fail the
// check) vs just comment. Deterministic from severities; acted on ONLY in CI.
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
  // Per-agent switch; a disabled link keeps its order but stays out of the prompt.
  enabled: z.boolean(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// PUT /agents/:id/skills — the agent's FULL ordered skill list (array order =
// prompt order). Replaces the previous set atomically; omitted skills are detached.
export const AgentSkillsSet = z.object({
  skills: z
    .array(z.object({ skill_id: z.string().uuid(), enabled: z.boolean().default(true) }))
    .max(200)
    .refine((items) => new Set(items.map((i) => i.skill_id)).size === items.length, {
      message: 'Each skill can be attached once',
    }),
});
export type AgentSkillsSet = z.infer<typeof AgentSkillsSet>;
