import { describe, it, expect, vi } from 'vitest';
import { FEATURE_MODELS, type FeatureModelChoice } from '@devdigest/shared';
import {
  IntentModelUnavailableError,
  pickIntentModel,
  type IntentModelDeps,
} from '../src/modules/reviews/intent/model.js';
import { defaultFeatureModel } from '../src/modules/settings/feature-models.js';

const onboardingDefault = defaultFeatureModel('onboarding');
const intentRegistryDefault = defaultFeatureModel('review_intent');

function deps(opts: {
  override?: FeatureModelChoice;
  fallback?: FeatureModelChoice;
  keys?: string[];
}): IntentModelDeps & { hasKey: ReturnType<typeof vi.fn> } {
  return {
    intentOverride: async () => opts.override,
    fallbackModel: async () => opts.fallback ?? onboardingDefault,
    hasKey: vi.fn(async (p: string) => (opts.keys ?? []).includes(p)),
  };
}

describe('pickIntentModel', () => {
  it('registry sanity: the review_intent default is the one that must never be chosen', () => {
    expect(intentRegistryDefault).toEqual({ provider: 'openai', model: 'gpt-4.1' });
    expect(FEATURE_MODELS.find((f) => f.id === 'onboarding')).toBeTruthy();
  });

  it('uses an explicit override as-is when its provider has a key', async () => {
    const d = deps({ override: { provider: 'anthropic', model: 'claude-x' }, keys: ['anthropic'] });
    expect(await pickIntentModel(d)).toEqual({ provider: 'anthropic', model: 'claude-x', source: 'override' });
  });

  it('override without a key -> 422, and does NOT fall back to onboarding even when that has a key', async () => {
    const d = deps({ override: { provider: 'anthropic', model: 'claude-x' }, keys: [onboardingDefault.provider] });
    const err = await pickIntentModel(d).catch((e) => e);
    expect(err).toBeInstanceOf(IntentModelUnavailableError);
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('intent_model_unavailable');
    expect(err.message).toContain('Settings > Models > PR Review · Intent');
  });

  it('no override -> the onboarding model (read from the registry, not hard-coded here)', async () => {
    const d = deps({ keys: [onboardingDefault.provider] });
    expect(await pickIntentModel(d)).toEqual({
      provider: onboardingDefault.provider,
      model: onboardingDefault.model,
      source: 'fallback_onboarding',
    });
  });

  it('no override -> the onboarding OVERRIDE when the workspace set one', async () => {
    const d = deps({ fallback: { provider: 'openai', model: 'gpt-mini' }, keys: ['openai'] });
    expect(await pickIntentModel(d)).toMatchObject({ provider: 'openai', model: 'gpt-mini', source: 'fallback_onboarding' });
  });

  it('no keys at all -> 422 with guidance', async () => {
    const err = await pickIntentModel(deps({ keys: [] })).catch((e) => e);
    expect(err).toBeInstanceOf(IntentModelUnavailableError);
    expect(err.statusCode).toBe(422);
    expect(err.message).toContain('Settings > Models > PR Review · Intent');
  });

  it('never picks the review_intent registry default (gpt-4.1) in any scenario', async () => {
    const scenarios = [
      deps({ keys: [] }),
      deps({ keys: ['openai'] }),
      deps({ keys: ['openai', 'anthropic', 'openrouter'] }),
      deps({ override: { provider: 'anthropic', model: 'claude-x' }, keys: ['openai'] }),
      deps({ override: { provider: 'openai', model: 'gpt-5' }, keys: ['openai'] }),
    ];
    for (const d of scenarios) {
      const r = await pickIntentModel(d).catch(() => null);
      if (r) expect(`${r.provider}/${r.model}`).not.toBe('openai/gpt-4.1');
    }
  });

  it('only consults local key lookups (no other dependency exists to reach the network)', async () => {
    const d = deps({ keys: [onboardingDefault.provider] });
    await pickIntentModel(d);
    expect(Object.keys(d).sort()).toEqual(['fallbackModel', 'hasKey', 'intentOverride']);
    expect(d.hasKey).toHaveBeenCalledTimes(1);
  });
});
