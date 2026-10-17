import type { FeatureModelChoice, IntentModelInfo } from '@devdigest/shared';
import { AppError } from '../../../platform/errors.js';
import { INTENT_MODEL_SETTINGS_HINT } from './constants.js';

/** 422: no usable model for the intent feature. Never silently substituted. */
export class IntentModelUnavailableError extends AppError {
  constructor(message: string) {
    super('intent_model_unavailable', message, 422);
  }
}

/** Local-only lookups the model choice needs (wired to the container by the service). */
export interface IntentModelDeps {
  /** Workspace override of `review_intent` (Settings > Models); undefined when unset. */
  intentOverride(): Promise<FeatureModelChoice | undefined>;
  /** The `onboarding` feature's model: its override, else its registry default. */
  fallbackModel(): Promise<FeatureModelChoice>;
  /** Is an API key configured for the provider? Local secrets lookup — no network. */
  hasKey(provider: FeatureModelChoice['provider']): Promise<boolean>;
}

/**
 * Pick the model for the intent call. No network, and never the registry default
 * of `review_intent`:
 *   1. an explicit `review_intent` override, used as-is (no key → 422, no fallback);
 *   2. else the `onboarding` feature's model, if its provider has a key;
 *   3. else 422 with guidance.
 */
export async function pickIntentModel(deps: IntentModelDeps): Promise<IntentModelInfo> {
  const override = await deps.intentOverride();
  if (override) {
    if (!(await deps.hasKey(override.provider))) {
      throw new IntentModelUnavailableError(
        `The model chosen for PR Review · Intent (${override.provider}/${override.model}) has no API key configured. ` +
          `Add the ${override.provider} key or pick another model in ${INTENT_MODEL_SETTINGS_HINT}.`,
      );
    }
    return { provider: override.provider, model: override.model, source: 'override' };
  }
  const fallback = await deps.fallbackModel();
  if (await deps.hasKey(fallback.provider)) {
    return { provider: fallback.provider, model: fallback.model, source: 'fallback_onboarding' };
  }
  throw new IntentModelUnavailableError(
    `No model is available for the PR intent: nothing is selected and the ${fallback.provider} key used by the default is missing. ` +
      `Choose a model in ${INTENT_MODEL_SETTINGS_HINT}.`,
  );
}
