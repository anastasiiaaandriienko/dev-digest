/**
 * Eval pipeline (L06) constants — see specs/eval-pipeline.md.
 */

/**
 * Widest line range (inclusive, in lines) the eval pipeline accepts: an eval case
 * whose expected range is wider is rejected at creation (`range_too_wide`, §7.5a),
 * and a kept finding whose range is wider can never be matched by the scorer
 * (FP `too_wide`, §8.3). A whole-file range must not "find" every issue in a file.
 */
export const EVAL_MAX_SPAN_LINES = 50;

/** Most labeled cases one eval run may contain (§9). */
export const EVAL_MAX_CASES = 50;

/** Most distinct frozen inputs (= engine calls) one eval run may contain (§9). */
export const EVAL_MAX_INPUT_GROUPS = 20;

/** Longest frozen diff (characters) an eval case may store (§7.3). */
export const EVAL_MAX_DIFF_CHARS = 400_000;

/**
 * A `running` eval run older than this that no process here is executing is failed by
 * the next `startRun` of its agent (§9). At boot every `running` run is failed instead.
 */
export const EVAL_STALE_RUN_MINUTES = 30;

/** Run history page size: default and maximum for `GET /agents/:id/eval-runs`. */
export const EVAL_RUNS_DEFAULT_LIMIT = 30;
export const EVAL_RUNS_MAX_LIMIT = 100;

/** Route rate limit for the endpoints that write cases or start paid runs (§6.2). */
export const EVAL_WRITE_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

/**
 * Most findings (kept + dropped) one engine call may return in an eval run. A
 * larger answer fails its group (and so the run) instead of being truncated:
 * dropping findings would hide false positives and inflate precision.
 */
export const EVAL_MAX_FINDINGS_PER_GROUP = 200;

/** Inputs the eval runner never passes to the engine (they are not frozen in a case). */
export const EVAL_EXCLUDED_INPUTS = ['repo_intel', 'intent', 'project_context', 'memory', 'conventions'] as const;

/** Author shown in the eval task line: the author is not part of the frozen input. */
export const EVAL_TASK_AUTHOR = 'the PR author';
