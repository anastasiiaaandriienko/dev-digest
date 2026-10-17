import { z } from 'zod';
import { SMART_GROUP_ORDER } from '../smart-diff-rules.js';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  // Optional so payloads persisted before L03 (no risk areas) still parse.
  risk_areas: z.array(z.string()).optional(),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
// HW-04 fields are optional so blast payloads stored before them (pr_brief) still parse.
// `line` and `url` refer to `source.ref` (the indexed commit), not to the PR head.
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
  line: z.number().int().optional(),
  url: z.string().nullable().optional(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  /** Enclosing symbol of the call site (file name when it is at module scope). */
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
  url: z.string().nullable().optional(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  /** File that declares `symbol`. */
  file: z.string().optional(),
  /** Direct callers, capped per symbol (see `truncated`). */
  callers: z.array(BlastCaller),
  /** Distinct direct callers before the cap. */
  caller_count: z.number().int().optional(),
  truncated: z.boolean().optional(),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

/**
 * Why a blast radius is incomplete: repo-intel off, no usable index (fallback
 * scan), a partial or failed index, or no stored files for the PR.
 */
export const BlastDegradedReason = z.enum([
  'flag_off',
  'no_data',
  'index_partial',
  'index_failed',
  'repo_too_large',
  'no_files',
]);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

export const BlastTotals = z.object({
  symbols: z.number().int(),
  callers: z.number().int(),
  endpoints: z.number().int(),
  crons: z.number().int(),
});
export type BlastTotals = z.infer<typeof BlastTotals>;

/** Repository and commit the lines / links refer to. */
export const BlastSource = z.object({
  repo_full_name: z.string(),
  ref: z.string(),
});
export type BlastSource = z.infer<typeof BlastSource>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  totals: BlastTotals.optional(),
  degraded: z.boolean().optional(),
  reason: BlastDegradedReason.nullable().optional(),
  source: BlastSource.nullable().optional(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
// Same keys, same order as the classification rules (../smart-diff-rules.ts).
export const SmartDiffRole = z.enum(SMART_GROUP_ORDER);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  /** New-side lines (ascending, unique) where at least one finding anchors on a changed/context line. */
  finding_lines: z.array(z.number().int()),
  /** All findings reported on this file (anchored or not). Optional: added with GET /pulls/:id/smart-diff. */
  findings_count: z.number().int().optional(),
  /** Findings on this file with no anchor on its changed side (not in finding_lines). */
  unanchored_findings: z.number().int().optional(),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
  /** Findings on files that are not part of this diff (shown in no group). */
  findings_outside_diff: z.number().int().optional(),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;
