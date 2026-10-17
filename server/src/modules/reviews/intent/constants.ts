/**
 * L03 Intent block constants.
 */

/**
 * Bump when the intent prompt or its output schema changes in a way that makes
 * stored intents out of date. Stored per row; a mismatch reports `prompt_changed`.
 */
export const INTENT_PROMPT_VERSION = 'intent-v2'; // v2: linked issues / links / planning docs context

/** Version of the canonical fingerprint payload (inside the hashed JSON). */
export const FINGERPRINT_VERSION = 1;

/** Feature id (Settings > Models) that may override the intent model. */
export const INTENT_FEATURE_ID = 'review_intent' as const;

/** Feature whose model is the keyless-default fallback (never the registry default of `review_intent`). */
export const INTENT_FALLBACK_FEATURE_ID = 'onboarding' as const;

/** Where the user fixes a missing model; shown in the 422 message. */
export const INTENT_MODEL_SETTINGS_HINT = 'Settings > Models > PR Review · Intent';

/**
 * How long ONE HTTP caller waits for the intent flight (then 504 `intent_timeout`).
 * It is NOT passed to the provider and does NOT abort the provider call: when a caller
 * times out the flight keeps running, stays registered as the single-flight entry so a
 * retry (also `force`) joins it instead of paying twice, and still saves its result.
 * True cancellation would need an AbortSignal in reviewer-core / the LLM adapters.
 */
export const INTENT_TIMEOUT_MS = 60_000;

/**
 * `timeoutMs` passed to `completeStructured`. 0 disables the OpenAI/Anthropic adapters'
 * outer `withTimeout` race (it returns the promise unchanged for ms <= 0; the adapters
 * use `req.timeoutMs ?? DEFAULT_TIMEOUT`, so 0 is kept). The provider promise then
 * settles only when the SDK request itself ends (bounded by the SDK's default timeout
 * and retries), so the flight cannot "time out" while the SDK request keeps running and
 * billing, and a retry cannot start a second overlapping paid call. OpenRouter ignores
 * `timeoutMs`. Real cancellation would need an adapter change.
 */
export const INTENT_PROVIDER_TIMEOUT_MS = 0;

// ---- fixed, user-safe error messages (never raw provider text) ----
export const INTENT_TIMEOUT_MESSAGE =
  'Intent generation is taking longer than expected; it may still complete — refresh in a moment.';
export const INTENT_INPUTS_INCOMPLETE_MESSAGE =
  'PR files are not synced yet — open the PR (or refresh) and try again.';
export const INTENT_PROVIDER_AUTH_MESSAGE =
  'The model provider rejected the API key — check Settings > API keys.';
export const INTENT_PROVIDER_RATE_LIMIT_MESSAGE =
  'The model provider rate-limited the request — try again later.';
export const INTENT_INVALID_OUTPUT_MESSAGE =
  'The model returned an invalid intent — try again or choose another model.';
export const INTENT_PROVIDER_ERROR_MESSAGE = 'The model provider returned an error.';
export const INTENT_SAVE_FAILED_MESSAGE = 'The generated intent could not be saved.';

// ---- prompt input limits (untrusted PR data, bounded before it reaches the model) ----
export const INTENT_TITLE_MAX_CHARS = 300;
export const INTENT_BODY_MAX_CHARS = 4_000;
export const INTENT_MAX_FILES = 300;
export const INTENT_MAX_HUNKS_PER_FILE = 20;
/** Budget for the whole file/hunk section of the prompt. */
export const INTENT_FILES_MAX_CHARS = 12_000;

// ---- context limits (linked issues, links, planning docs; all untrusted) ----
/** Same-repo issues fetched per intent run; further references are listed as `over_limit`, never fetched. */
export const INTENT_MAX_ISSUES = 3;
/** Links (never fetched) listed per intent. */
export const INTENT_MAX_LINKS = 10;
/** Planning docs from the PR diff included per intent. */
export const INTENT_MAX_PLAN_DOCS = 3;
export const INTENT_ISSUE_TITLE_MAX_CHARS = 200;
export const INTENT_ISSUE_BODY_MAX_CHARS = 1_500;
export const INTENT_PLAN_DOC_MAX_CHARS = 2_000;
export const INTENT_CONTEXT_LINK_MAX_CHARS = 200;
/** Budget for the whole context section of the prompt. */
export const INTENT_CONTEXT_MAX_CHARS = 6_000;
/** Bound on ONE issue fetch (the adapter retries inside it); a timeout marks the issue `fetch_failed`. */
export const INTENT_ISSUE_FETCH_TIMEOUT_MS = 10_000;

// ---- output limits (model output is data too) ----
export const INTENT_MAX_LIST_ITEMS = 10;
export const INTENT_MAX_SUMMARY_CHARS = 1_000;
export const INTENT_MAX_ITEM_CHARS = 300;
