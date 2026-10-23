/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * Max agent runs of ONE review request executing at the same time (L07,
 * AC-MAR-05). Applies to every request — `agentIds`, `all:true` and a single
 * `agentId` alike; the rest wait in input order for a free slot.
 */
export const REVIEW_CONCURRENCY = 4;

/**
 * Server-side bound (`SET LOCAL lock_timeout` + `statement_timeout`) for each
 * terminal-state write/read made after a run fails — e.g. the probe after an
 * ambiguous commit, which could otherwise wait on a lock held by a transaction
 * whose client already gave up. See specs/review-run-cost.md §3.7.
 */
export const RECONCILE_DB_TIMEOUT_MS = 5_000;

/**
 * Client-side backstop for the whole reconciliation (covers connection
 * acquisition and a dead socket, which the server-side timeouts cannot).
 */
export const RECONCILE_DEADLINE_MS = 15_000;

/**
 * GET /pulls/:id/smart-diff: a PR is "too big" above this many changed lines
 * (additions + deletions), boilerplate (lockfiles, generated output, assets)
 * excluded. ~400 lines is the commonly cited limit for an effective review.
 */
export const SMART_DIFF_SPLIT_THRESHOLD_LINES = 400;

/** Leading directory segments used to propose splits when all files share one role. */
export const SMART_DIFF_SPLIT_DIR_DEPTH = 2;
