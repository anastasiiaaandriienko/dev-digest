import {
  IntentConfidence,
  type Intent,
  type IntentFreshness,
  type IntentModelInfo,
  type IntentStaleReason,
  type PrIntentMeta,
} from '@devdigest/shared';
import type { IntentRow } from '../repository/intent.repo.js';
import { INTENT_PROMPT_VERSION } from './constants.js';

/** What the stored row is compared against. */
export interface CurrentIntentInput {
  /** Fingerprint of the current PR input (computed with `files: null` when files are unknown). */
  fingerprint: string;
  headSha: string;
  /** False when no `pr_files` are stored locally (the file list is unknown). */
  filesKnown: boolean;
  /** The model the next run would use; null when none is available. */
  model: IntentModelInfo | null;
}

export interface Freshness {
  freshness: IntentFreshness;
  stale_reasons: IntentStaleReason[];
}

/**
 * Freshness of a stored intent.
 *  - no row            -> `unknown` with no reasons (nothing to be fresh or stale; `intent` is null).
 *  - any definite reason -> `stale`:
 *      pr_changed     stored fingerprint differs from the current one; a NULL stored fingerprint
 *                     (row from before L03) counts as changed. When the current file list is unknown
 *                     the fingerprint cannot be compared, so only a different head SHA counts.
 *      prompt_changed stored prompt_version differs from INTENT_PROMPT_VERSION (NULL = changed).
 *      model_changed  stored provider/model differ from the currently resolved model. Not evaluated
 *                     when no model is available.
 *  - no reason but file data unknown -> `unknown` (we cannot prove the PR is unchanged).
 *  - otherwise `fresh`.
 */
export function evaluateFreshness(row: IntentRow | undefined, current: CurrentIntentInput): Freshness {
  if (!row) return { freshness: 'unknown', stale_reasons: [] };
  const reasons: IntentStaleReason[] = [];
  const prChanged =
    row.inputFingerprint == null ||
    (current.filesKnown ? row.inputFingerprint !== current.fingerprint : row.headSha !== current.headSha);
  if (prChanged) reasons.push('pr_changed');
  if (row.promptVersion !== INTENT_PROMPT_VERSION) reasons.push('prompt_changed');
  if (current.model && (row.provider !== current.model.provider || row.model !== current.model.model)) {
    reasons.push('model_changed');
  }
  if (reasons.length > 0) return { freshness: 'stale', stale_reasons: reasons };
  return { freshness: current.filesKnown ? 'fresh' : 'unknown', stale_reasons: [] };
}

/**
 * True when POST without `force` may skip the model call: the stored row is fresh.
 * Intents are never computed (or saved) from an unknown file list, so an
 * "unknown" row is never a cache hit; the service handles that case separately.
 */
export function isCacheHit(row: IntentRow | undefined, current: CurrentIntentInput): boolean {
  return evaluateFreshness(row, current).freshness === 'fresh';
}

export function toIntent(row: IntentRow): Intent {
  return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope, risk_areas: row.riskAreas };
}

export function toMeta(row: IntentRow): PrIntentMeta {
  const confidence = IntentConfidence.safeParse(row.confidence);
  return {
    provider: row.provider,
    model: row.model,
    prompt_version: row.promptVersion,
    confidence: confidence.success ? confidence.data : null,
    generated_at: row.generatedAt.toISOString(),
    head_sha: row.headSha,
    input_snapshot_at: row.inputSnapshotAt ? row.inputSnapshotAt.toISOString() : null,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
  };
}
