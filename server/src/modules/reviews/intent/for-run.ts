import type { PrIntentState } from '@devdigest/shared';
import { intentPolicyFor, type PromptIntent } from '@devdigest/reviewer-core';
import type { IntentService } from './service.js';

/**
 * The only thing the review executor needs from the intent flow (a fake in unit
 * tests). `resolveForRun` never throws and never writes a review/run row.
 */
export type IntentResolver = Pick<IntentService, 'resolveForRun'>;

/** Map the stored/generated intent to what reviewer-core renders; null when there is none. */
export function toPromptIntent(state: PrIntentState | null): PromptIntent | null {
  if (!state?.intent) return null;
  return {
    summary: state.intent.intent,
    in_scope: state.intent.in_scope,
    out_of_scope: state.intent.out_of_scope,
    risk_areas: state.intent.risk_areas ?? [],
    confidence: state.meta?.confidence ?? null,
  };
}

/** Live Log line: where the intent came from. No provider/error text, ever. */
export function intentSourceLine(state: PrIntentState): string {
  if (state.computed === true) {
    return `intent: generated — cost ${state.meta?.cost_usd ?? 'unknown'} billed separately (not in review run cost)`;
  }
  return 'intent: reused stored intent (no model call)';
}

/** Live Log line: what the prompt received. */
export function intentAttachedLine(intent: PromptIntent): string {
  const conservative = intentPolicyFor(intent.confidence).includes('You MAY omit');
  return `intent: attached (confidence=${intent.confidence ?? 'unknown'}, policy=${conservative ? 'conservative' : 'inform'})`;
}

export const INTENT_UNAVAILABLE_LINE = 'intent: unavailable — continuing without intent';
