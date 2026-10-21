import type { BriefReviewFocus, Intent, IntentFreshness, IntentStaleReason, PrBrief, Risk } from '@devdigest/shared';
import {
  BRIEF_MAX_FOCUS,
  BRIEF_MAX_ITEM_CHARS,
  BRIEF_MAX_RISKS,
  BRIEF_MAX_SUMMARY_CHARS,
  BRIEF_PROMPT_VERSION,
} from './constants.js';
import type { BriefGeneration } from './prompt.js';

export interface ValidatedBrief {
  summary: string;
  risks: Risk[];
  review_focus: BriefReviewFocus[];
}

const bound = (s: string, max: number): string => s.trim().slice(0, max);

const isPositiveInt = (n: number): boolean => Number.isSafeInteger(n) && n >= 1;

/**
 * A model file reference is kept only as `path` or `path:<int ≥ 1>` where `path`
 * is a changed file. Only a trailing `:<digits>` is parsed. Returned verbatim
 * (trimmed) so the UI can link it; never used for filesystem access.
 */
function validRef(ref: string, changed: ReadonlySet<string>): string | null {
  const r = ref.trim();
  if (changed.has(r)) return r;
  const m = /^(.*):(\d+)$/.exec(r);
  if (!m) return null;
  const line = Number(m[2]);
  return changed.has(m[1]!) && isPositiveInt(line) ? r : null;
}

/**
 * Drops and caps applied to the model output (the generation schema has no caps):
 *  - focus items on a path that is not a changed file, or with a line that is not an integer ≥ 1, are dropped; the first 8 remain;
 *  - risk `file_refs` that are not a changed path (optionally `:line`) are dropped; the first 6 risks remain;
 *  - strings are trimmed and bounded.
 */
export function validateBriefOutput(gen: BriefGeneration, changedPaths: Iterable<string>): ValidatedBrief {
  const changed = new Set(changedPaths);

  const review_focus: BriefReviewFocus[] = [];
  for (const f of gen.review_focus) {
    if (review_focus.length >= BRIEF_MAX_FOCUS) break;
    if (!changed.has(f.path) || !isPositiveInt(f.line)) continue;
    review_focus.push({ path: f.path, line: f.line, reason: bound(f.reason, BRIEF_MAX_ITEM_CHARS) });
  }

  const risks: Risk[] = gen.risks.slice(0, BRIEF_MAX_RISKS).map((r) => ({
    kind: bound(r.kind, BRIEF_MAX_ITEM_CHARS),
    title: bound(r.title, BRIEF_MAX_ITEM_CHARS),
    explanation: bound(r.explanation, BRIEF_MAX_ITEM_CHARS),
    severity: r.severity,
    file_refs: r.file_refs.map((x) => validRef(x, changed)).filter((x): x is string => x !== null),
  }));

  return { summary: bound(gen.summary, BRIEF_MAX_SUMMARY_CHARS), risks, review_focus };
}

export interface BriefFreshness {
  freshness: IntentFreshness;
  stale_reasons: IntentStaleReason[];
}

/**
 * Freshness of a stored brief (A5, no fingerprint):
 *  - no brief, or one without `meta` -> `unknown`, no reasons;
 *  - `pr_changed` stored head_sha differs; `prompt_changed` prompt_version differs from BRIEF_PROMPT_VERSION;
 *    `model_changed` provider/model differ (not evaluated when no model is resolved);
 *  - any reason -> `stale`, otherwise `fresh`.
 */
export function evaluateBriefFreshness(
  brief: PrBrief | null,
  current: { headSha: string; model: { provider: string; model: string } | null },
): BriefFreshness {
  const meta = brief?.meta;
  if (!meta) return { freshness: 'unknown', stale_reasons: [] };
  const reasons: IntentStaleReason[] = [];
  if (meta.head_sha !== current.headSha) reasons.push('pr_changed');
  if (meta.prompt_version !== BRIEF_PROMPT_VERSION) reasons.push('prompt_changed');
  if (current.model && (meta.provider !== current.model.provider || meta.model !== current.model.model)) {
    reasons.push('model_changed');
  }
  return reasons.length > 0 ? { freshness: 'stale', stale_reasons: reasons } : { freshness: 'fresh', stale_reasons: [] };
}

/** The stored `pr_intent` row as the brief's `intent`; null when there is no row. */
export function toStoredIntent(
  row: { intent: string; inScope: string[]; outOfScope: string[]; riskAreas: string[] } | undefined | null,
): Intent | null {
  if (!row) return null;
  return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope, risk_areas: row.riskAreas };
}
