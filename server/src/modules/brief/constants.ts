/**
 * PR Brief constants. Standalone: nothing is imported from modules/context
 * (AC-BRIEF-28).
 */

export const BRIEF_PROMPT_VERSION = 'brief-v1';
/** Feature-model key resolved through settings/feature-models. */
export const BRIEF_FEATURE_ID = 'risk_brief';

/** Per provider attempt (D18). */
export const BRIEF_INPUT_MAX_TOKENS = 8000;
/** Output cap passed to the adapter as maxTokens. */
export const BRIEF_OUTPUT_MAX_TOKENS = 2000;
/**
 * Server-assembled messages budget = 8,000 - 2,000 (raw output a repair attempt
 * appends) - 1,500 (reprompt, schema/tokenizer overhead). An allowance, not a
 * code-enforced bound on the reprompt (D19).
 */
export const BRIEF_ASSEMBLY_MAX_TOKENS = 4500;
export const BRIEF_BODY_MAX_TOKENS = 1500;

/** Caller waits at most this long, then 504; the flight keeps running and saves. */
export const BRIEF_TIMEOUT_MS = 60000;
/** 0 = no provider-level timeout (the caller-side timeout above applies). */
export const BRIEF_PROVIDER_TIMEOUT_MS = 0;

export const BRIEF_MAX_FOCUS = 8;
export const BRIEF_MAX_RISKS = 6;
export const BRIEF_TITLE_MAX_CHARS = 300;
export const BRIEF_MAX_ITEM_CHARS = 600;
export const BRIEF_MAX_SUMMARY_CHARS = 1200;

// ---- fixed user-facing messages (never provider/GitHub error text) ----
export const BRIEF_TIMEOUT_MESSAGE =
  'Brief generation is taking longer than expected; it may still complete — refresh in a moment.';
export const BRIEF_INPUTS_INCOMPLETE_MESSAGE =
  'PR files are not synced yet — open the PR (or refresh) and try again.';
export const BRIEF_MODEL_UNAVAILABLE_MESSAGE =
  'No model is available for the PR brief — add an API key in Settings > API keys.';
export const BRIEF_PROVIDER_AUTH_MESSAGE =
  'The model provider rejected the API key — check Settings > API keys.';
export const BRIEF_PROVIDER_RATE_LIMIT_MESSAGE =
  'The model provider rate-limited the request — try again later.';
export const BRIEF_INVALID_OUTPUT_MESSAGE =
  'The model returned an invalid brief — try again or choose another model.';
export const BRIEF_PROVIDER_ERROR_MESSAGE = 'The model provider returned an error.';
export const BRIEF_SAVE_FAILED_MESSAGE = 'The generated brief could not be saved.';
