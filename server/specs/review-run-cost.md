# Spec: review run cost (L01, server side)

- **Status:** storage decided (**Option B**): cost lives in
  `run_traces.trace.stats.cost_usd` (jsonb). No schema change, no migration.
  **Implemented end to end (Steps 1–5, §11).** Write path §3.3–§3.7 (decisions in
  §3.11), read paths §4.2–§4.3, contracts §5, client UI per
  [../../client/specs/l01-review-ui.md](../../client/specs/l01-review-ui.md) §1.
- **Decision:** made by the repository owner on 2026-10-11 (§2).
- **Scope:** the server data and contracts that let the UI show a run's cost in
  three places: the PR list, the run timeline and the Trace drawer.
- **Verified against source:** 2026-10-11.

Labels:
- **[implemented]** = current code
- **[gap]** = where data is lost today
- **[proposal]** = the change to make
- **[potential bug]** = found by reading the code, not reproduced

## 1. Current cost data flow

```
provider adapter ──costUsd──▶ reviewer-core reviewPullRequest ──costUsd──▶ run-executor ✗ dropped
```

1. **[implemented] Providers compute a cost for each call.** It is returned as
   `StructuredResult.costUsd: number | null` (`src/vendor/shared/adapters.ts:77`).
   - **OpenAI / Anthropic:** `estimateCost(model, tokensIn, tokensOut)` reads the
     static table in `src/adapters/llm/pricing.ts:37`. The result is `null` for any
     model not in the table, and the table itself is approximate.
   - **OpenRouter** (`reviewer-core/src/llm/openrouter.ts:83-107`):
     - It requests `usage: { include: true }` and adds up the real `usage.cost`
       across parse-repair attempts.
     - If no cost comes back, it falls back to the injected `priceBook.estimate`
       (`src/platform/container.ts:185-188`).
     - `PriceBook` (`src/platform/price-book.ts`) caches live OpenRouter prices for
       6 h and falls back to the static table, so a cold cache uses the static table.
   - **Mock:** `MockLLMProvider` always returns `costUsd: 0.001` (`src/adapters/mocks.ts`).
2. **[implemented] reviewer-core adds up cost per chunk.**
   (`reviewer-core/src/review/run.ts:159,184,216`)
   - If any chunk's cost is `null`, the whole run's cost is `null`. It is never treated as 0.
   - The total is exposed as `ReviewOutcome.costUsd` (`run.ts:110`).
3. **[gap] The server throws the cost away.**
   - `src/modules/reviews/run-executor.ts:213` takes only `{ tokensIn, tokensOut, grounding }` from the outcome.
   - The trace's `stats` object (`run-executor.ts:264-270`) has no cost field.
4. **[gap] Nothing carries cost to the UI.**
   - `agent_runs` has no `cost_usd` column (`src/db/schema/runs.ts:8-31`). Migration
     `0009_complex_runaways` (commit `d45ab0d`) dropped it, and Option B does not add it back.
   - **[implemented, Step 1]** `RunStats.cost_usd`, `RunSummary.cost_usd`
     (`src/vendor/shared/contracts/trace.ts`) and `PrMeta.cost_usd` / `cost_partial`
     (`src/vendor/shared/contracts/platform.ts`) now exist in both `vendor/shared`
     copies, all optional (§5). No server code writes or returns them yet.
5. **[gap] Failed and cancelled runs lose usage.**
   - The failure path writes `tokensIn/out = 0` (`run-executor.ts:297-307`), even
     when LLM calls were already made.
   - Its trace comes from `traceFromBuffer`, which has no cost either.

`eval_runs.cost_usd` and `ci_runs.cost_usd` exist for later lessons. They are not
used here.

## 2. Decision: Option B (trace JSONB, no migration)

**Chosen:** store each run's cost in the run's existing trace document, as
`run_traces.trace.stats.cost_usd`. Read it back with jsonb extraction where a list
needs it.

**Rejected:** Option A, a restored `agent_runs.cost_usd` column. It needs a schema
change plus a migration, and the owner chose to avoid that for L01. If the
limitations in §6 start to hurt (L07/L08 dashboards, large histories), revisit it.
Moving to a column later means a migration plus a one-off backfill from the trace
documents.

**Also rejected:** computing cost on read from `tokens_in/out` × `PriceBook`:
- it loses OpenRouter's real `usage.cost`;
- the result changes whenever prices change;
- failed runs would show 0.

## 3. Write path

### 3.1 Value rules (unchanged)

- **Successful run:** destructure `costUsd` from the outcome next to `tokensIn` and
  `tokensOut` (`run-executor.ts:213`), and write `stats.cost_usd: costUsd` into the
  trace: a number, or `null` when unknown.
- **Failed, cancelled or pre-work failure** (`traceFromBuffer`, `run-executor.ts:408-432`):
  write `stats.cost_usd: null`.
- **Value:** store reviewer-core's figure exactly as returned. Do not re-estimate,
  round or format it. `0` is a known zero; `null` is unknown.
- **Unchanged:** the `agent_runs` columns.

### 3.2 [implemented] Current success-path sequence

`ReviewRunExecutor.runOneAgent` (`src/modules/reviews/run-executor.ts:138-314`).
Every write is a separate auto-committed statement on the shared `Db`; there is no
transaction anywhere in `server/src` (no `db.transaction(` call).

| # | Line | Call | Writes |
|---|---|---|---|
| 1 | 190 | `reviewPullRequest(...)` | nothing (LLM spend happens here) |
| 2 | 218 | `repo.insertReview` | `reviews` row (`run_id` = runId) |
| 3 | 229 | `repo.insertFindings` | `findings` rows (none if 0 findings) |
| 4 | 230 | `runLog.result('Persisted review <id> …')` | SSE event (in-memory) |
| 5 | 234 | `repo.markReviewed` | `pull_requests.last_reviewed_sha` |
| 6 | 243 | `repo.completeAgentRun('done', …)` | `agent_runs` — unconditional `WHERE id = runId` (`run.repo.ts:159-172`) |
| 7 | 255-284 | build `RunTrace` | log = `runLog.logFor(runId)` (bus buffer) |
| 8 | 285 | `runLog.info('Run complete; trace persisted')` | SSE event, emitted **before** the save |
| 9 | 286 | `repo.saveRunTrace` | `run_traces` upsert |
| 10 | 287 | `runBus.complete(runId)` | SSE `done`, clears the cancel flag |

Failure path (`catch`, `run-executor.ts:290-313`): unconditional
`completeAgentRun('failed' | 'cancelled')` with zeros, then `saveRunTrace(traceFromBuffer(...))`,
both wrapped in `.catch(() => undefined)`, then `runBus.complete`. The pre-work
failure path `failAll` (`run-executor.ts:75-93`) does the same for every queued run.

Cancellation (`ReviewService.cancelRun`, `service.ts:85-90`): `runBus.cancel` →
`cancelRunIfRunning` (`UPDATE … SET status='cancelled' WHERE id AND status='running'`,
`run.repo.ts:93-100`) → `runBus.complete`, which deletes the cancel flag
(`sse.ts:79`). The runner only checks the flag at `checkCancelled()` before each LLM
chunk (`reviewer-core/src/review/run.ts:164`).

Consequences of the current sequence:
- After step 6 and before step 9 the run is `done` with no trace (§6.1).
- A throw in steps 2–9 (e.g. the trace upsert) jumps to the `catch`, which overwrites
  `done` with `failed`; the review and findings from steps 2–3 stay attached to a
  `failed` run (§6.2).
- If cancel commits while step 1 is running and the runner never sees the flag,
  step 6 overwrites `cancelled` with `done` (§6.7).

### 3.3 [proposal, direction approved] `finalizeDoneRun`: one transaction for the successful run

Replace steps 2, 3, 5, 6 and 9 of §3.2 with one repository call that runs in a
single Postgres transaction.

**Sharing one transaction client (verified):**
- `Db` is `PostgresJsDatabase<typeof schema>` (`src/db/client.ts:5`). Drizzle's
  postgres-js `transaction()` calls `client.begin(...)`, which reserves one
  connection. Every query issued through `tx` runs on that connection. The
  callback resolving → `COMMIT`; the callback throwing → `ROLLBACK`
  (`node_modules/drizzle-orm/postgres-js/session.js:96-109`). A nested
  `tx.transaction(...)` becomes a `SAVEPOINT` (`session.js:118-128`).
- A `PostgresJsTransaction` is assignable to `Db`. A scratch typecheck that passes
  `tx` to `insertReview`, `completeAgentRun` and `saveRunTrace` compiles under the
  server `tsconfig`; a negative control (passing a `string`) fails with TS2345.
- The reused functions use only their `db` parameter: no module-level client, no
  nested transaction, no call into another module (`review.repo.ts:11-55`,
  `pull.repo.ts:40-45`, `run.repo.ts:176-181`). Their other callers keep passing
  `this.db`, so their behaviour does not change.
- No triggers or functions in `src/db/migrations/` (no `CREATE TRIGGER` /
  `CREATE OR REPLACE FUNCTION`), so the statements have no hidden side effects.

**Placement (D4): `run.repo.ts`.** Today none of `run.repo.ts`, `review.repo.ts`
and `pull.repo.ts` imports another (only drizzle, `Db`, `schema`, contracts, `rows`).
`finalizeDoneRun` adds one-way imports `run.repo → review.repo` (`insertReview`,
`insertFindings`) and `run.repo → pull.repo` (`markReviewed`). There is no
cycle, and `ReviewRepository` (`repository.ts:21-23`) already composes all three.
It is exposed as `ReviewRepository.finalizeDoneRun(input)`.

**Input** (computed before the transaction; nothing depends on generated ids):

```ts
{
  runId: string;
  review: {            // same shape as insertReview's values today
    workspaceId; prId; agentId; runId; kind: 'review'; verdict; summary; score; model;
  };
  findings: Finding[];               // outcome.review.findings (already grounded)
  reviewedSha: { prId: string; sha: string };   // pull.id, pull.headSha
  completion: {                      // the agent_runs columns written today at step 6
    durationMs; tokensIn; tokensOut;
    findingsCount;                   // = findings.length (insertFindings inserts 1:1, review.repo.ts:29-55)
    grounding; score; blockers;
  };
  trace: RunTrace;                   // stats.cost_usd = outcome.costUsd; stats.findings = findings.length;
                                     // log = runLog.logFor(runId) taken BEFORE the call (D1)
}
```

**Output:**

```ts
| { finalized: true;  review: ReviewRow; findings: FindingRow[] }
| { finalized: false; currentStatus: string | null }   // null = the agent_runs row is gone
```

**Order inside the transaction:**

1. **Claim:** `UPDATE agent_runs SET status='done', duration_ms, tokens_in,
   tokens_out, findings_count, grounding, score, blockers, error=NULL
   WHERE id = :runId AND status = 'running' RETURNING id`.
   - 0 rows → `SELECT status FROM agent_runs WHERE id = :runId` and return
     `{ finalized: false, currentStatus }` with no other write. The read is stable:
     0 rows means the row was terminal or missing when the `UPDATE` ran. Only
     `createAgentRun` writes `running`, and only for new rows.
   - 1 row → the transaction holds the row lock until it ends.
2. `insertReview(tx, input.review)`
3. `insertFindings(tx, review.id, input.findings)`
4. `markReviewed(tx, prId, sha)`
5. `saveRunTrace(tx, runId, input.trace)` (the existing upsert)
6. Return `{ finalized: true, review, findings }` → `COMMIT`.

**Rollback:** any throw in steps 1–5 rolls back everything, including `done`. Under
the default READ COMMITTED isolation, uncommitted rows are invisible to other
sessions, so nobody sees a `done` run without its review, findings and trace.

**Not in the transaction:** the LLM call, `countBlockers`, building the trace, SSE
events and `runBus.complete`. None of them write to the DB, and an LLM call must
never hold a pooled connection (`max: 10`, `client.ts:18`).

**`completeAgentRun` (D3):** unchanged and still unconditional. After Step 2 the
executor no longer calls it, and it has no other callers (`run-executor.ts:78,243,298`
are the only ones). Whether to keep it or delete it is open item O2 (§3.11).

### 3.4 [proposal] Claim vs. cancel: is `WHERE status = 'running'` enough?

**Yes. A conditional `UPDATE` plus its row count is enough, and `CASE` is not
needed.** `cancelRunIfRunning` (`run.repo.ts:93-100`) and the claim are both
`UPDATE … WHERE id = :runId AND status = 'running'` on the same row. In Postgres, a
second `UPDATE` on a row locked by an uncommitted transaction waits. After that
transaction ends, it re-checks its `WHERE` against the latest row version. So
exactly one of the two writers matches.

| Interleaving | Result |
|---|---|
| Cancel commits before the claim | Claim matches 0 rows → `finalized: false, currentStatus: 'cancelled'`. No review, findings, `last_reviewed_sha` change or success trace; the run stays `cancelled` |
| Claim takes the lock first, then commits | `cancelRunIfRunning` waits, re-checks, sees `done`, updates 0 rows → the run stays `done` |
| Claim takes the lock first, then rolls back | `cancelRunIfRunning` waits, sees `running`, cancels |
| Runner sees the flag at `checkCancelled()` | Unchanged: `RunCancelledError` → §3.5 cancel operation |

No `SELECT … FOR UPDATE` and no SERIALIZABLE isolation is needed: the `UPDATE`
itself takes the row lock.

`CASE` would only be needed if one statement had to write different values
depending on the current status. The claim never does: it either takes a
`running` row or writes nothing.

### 3.5 [proposal] Terminal operations for failure and cancel (D2, D3)

Three new conditional functions in `run.repo.ts`, used only by the executor. They
leave `completeAgentRun` and `cancelRunIfRunning` unchanged.

**`recordRunFailed(db, runId, { durationMs, error })` → `'transitioned' | 'noop'`**

```sql
UPDATE agent_runs SET status='failed', duration_ms=:d, tokens_in=0, tokens_out=0,
       findings_count=0, grounding='0/0 passed', score=NULL, blockers=NULL, error=:e
WHERE  id=:runId AND status='running' RETURNING id
```

It never touches `done`, `cancelled` or `failed` rows.

**`recordRunCancelled(db, runId, { durationMs })` → `'transitioned' | 'annotated' | 'noop'`**

- **A:** the same columns as today's cancel write, `status='cancelled'`,
  `error='Cancelled by user'`, `WHERE id=:runId AND status='running'`. This happens
  when the runner saw the flag before `cancelRunIfRunning` committed: `runBus.cancel`
  runs before the DB update (`service.ts:87-88`).
- **B**, only when A updated 0 rows: the same metadata columns, **without `status`**,
  `WHERE id=:runId AND status='cancelled' AND error IS NULL`.
  `cancelRunIfRunning` sets only `status` (`run.repo.ts:96`), so a user-cancelled
  row has `error IS NULL` until the runner fills it in. B fills it once and never
  changes the terminal status. **This is how D2 is met:** an already-cancelled run
  keeps its status and still gets its metadata.
- **Order A → B is required.** If B ran first and missed, a cancel committing in
  between would leave A with 0 rows too. After A misses, the row is terminal or
  gone, and no guarded writer changes a terminal row, so B sees a stable state.
- Two statements, not `CASE`. A single
  `SET status = CASE WHEN status='running' THEN 'cancelled' ELSE status END` form
  is possible, but it gains nothing over A → B.

**`insertRunTraceIfAbsent(db, runId, trace)` → `boolean`**

`INSERT … ON CONFLICT (run_id) DO NOTHING RETURNING run_id`. Used for the buffer
trace (`stats.cost_usd: null`) after `'transitioned'` or `'annotated'`, so an
existing trace (for example a committed success trace) is never overwritten. It
throws on an FK violation if the run row was deleted; callers catch that
(best-effort, as today).

**`getRunStatus(db, runId)` → `{ status: string | null } | undefined`**

A plain read, used only by the reconciliation in §3.6.

`failAll` (pre-work failure) uses `recordRunFailed` + `insertRunTraceIfAbsent` per
run.

### 3.6 [proposal] Executor control flow and event ordering

**Success** (`finalized: true`), in this order:
1. `runLog.result('Persisted review <id> with N finding(s)')`
2. `runLog.info('Run complete; trace persisted')`
3. `runBus.complete(runId)`

All three happen after the commit (D1). The persisted trace log ends before these
lines because it was taken before the call. **No success event and no `runBus`
completion is published before the commit.**

**Reconciliation** runs on any throw (LLM, grounding, `finalizeDoneRun`, …) and on
`finalized: false`:

1. Write the terminal state:
   - `RunCancelledError`, or `finalized: false` with `currentStatus: 'cancelled'`
     → `recordRunCancelled`;
   - anything else → `recordRunFailed`.
   Both are best-effort: an error here is treated as `'unknown'`.
2. Pick the event from the DB result, not from the exception:

   | Result | Event | Trace |
   |---|---|---|
   | `transitioned` / `annotated` (cancel) | `error: 'Run cancelled by user'` | buffer trace via `insertRunTraceIfAbsent` |
   | `transitioned` (failed) | `error: 'Run failed: <msg>'` | buffer trace via `insertRunTraceIfAbsent` |
   | `noop` → `getRunStatus` = `done` | `info: 'Run complete (confirmed after a persistence error)'` | none (the committed trace stays) |
   | `noop` → `cancelled` (after `recordRunFailed`) | call `recordRunCancelled` (B) and continue as in the cancel row | as cancel |
   | `noop` → `failed` / other | `info: 'Run already ended with status <s>'` | none |
   | `noop` → row missing | `info: 'Run no longer exists'` | none |
   | `unknown` (write or read threw) | `error: 'Run outcome unknown: <msg>'` | none |

3. Build the buffer trace **after** publishing that event, so the trace contains the
   terminal line, then call `insertRunTraceIfAbsent` (best-effort).
4. `runBus.complete(runId)`, then rethrow as today (`executeRuns` logs it).

Today the `catch` publishes `Run failed` **before** any write (`run-executor.ts:296`).
Step 2 moves that publication after the guarded write.

**Ordering against `cancelRun`** (`service.ts:85-90`):
1. Publish `Cancellation requested`.
2. `runBus.cancel`.
3. `cancelRunIfRunning` (waits if a finalization holds the row).
4. `runBus.complete`.

- That `complete` emits SSE `done`, which carries no status (`sse.ts:76-83`;
  `routes.ts:66-69` only ends the stream). It is emitted only after step 3 returns,
  so after any concurrent finalization has committed or rolled back: no success
  signal comes before a commit.
- If the finalization won and the cancel came late, the stream may end before the
  executor publishes its post-commit success lines. They still go into the buffer
  (`publish` recreates the emitter, `sse.ts:37-49`), but that stream's subscribers
  are gone. The client sees `done` when it refetches. This is a known Live Log gap
  (O3).
- The executor's own `runBus.complete` afterwards is harmless: it re-adds to
  `completed` and emits to no listeners.

### 3.7 [proposal] Ambiguous commit

The claim is inside the transaction, so **committed ⇔ `status = 'done'`**. When
`finalizeDoneRun` rejects, the executor does not assume it failed. The guarded
`recordRunFailed` is the probe:
- **Committed** → the probe matches 0 rows → `getRunStatus` = `done` → `info`
  event; no overwrite, and the trace stays.
- **Not committed** → the row is still `running` → `failed` + buffer trace.
- **COMMIT still in progress on the server** → the probe waits on the row lock,
  then re-checks (§3.4 semantics) and lands in one of the two cases above.

A committed `done` is therefore never overwritten by `failed`, and its trace is
never replaced (`insertRunTraceIfAbsent`).

**Residual:** if the client lost the socket but the server-side backend is still
alive inside the transaction (it holds the lock and has not noticed the
disconnect), the probe waits until Postgres aborts that backend. `createDb` sets no
`statement_timeout` or `lock_timeout` (`client.ts:17-19`). A bound on the probe is
open item O1. If it times out, the result is `unknown`: the event is
`Run outcome unknown`, the row is left as is, and if it is still `running` the
boot reaper marks it `failed` later.

### 3.8 [proposal] When the trace write fails

A failing `saveRunTrace` (§3.3 step 5) rolls back the claim, review, findings and
`last_reviewed_sha`. Reconciliation then sees `running` → `transitioned` → the
event `Run failed: <msg>` → the buffer trace (`cost_usd: null`) is attempted
best-effort. The outcome is a **`failed` run with no review**, which matches the
UI. The LLM spend is lost, like for any failed run (§6.6).

"Keep `done` and drop the trace" is rejected: under Option B the trace holds the
cost (AC 1), and the Trace drawer would 404.

Between `recordRunFailed` and `insertRunTraceIfAbsent`, a failed run is briefly
visible without a trace. That is the same as today.

### 3.9 Existing constraints checked

- `run_traces.run_id` is the PK and an FK to `agent_runs(id) ON DELETE CASCADE`
  (`db/schema/runs.ts:34-39`).
- `reviews.run_id` has **no FK** (`db/schema/reviews.ts:19`). `reviews.pr_id` is
  `NOT NULL` with an FK to `pull_requests`. A PR deleted mid-run makes §3.3 step 2
  fail → rollback → `failed` (today it leaves a partial write instead).
- `agent_runs.status` is free `text` with no CHECK (`runs.ts:21`); the guards
  compare literal strings.
- `markReviewed` locks the `pull_requests` row. Lock order is always own
  `agent_runs` row → `pull_requests` row, so two finalizations cannot deadlock.
  `executeRuns` runs a PR's agents sequentially (`run-executor.ts:107`).
- **Race left as is:** `deleteAgentRun` (`run.repo.ts:77-90`) deletes `reviews` by
  `run_id` and then the run. During an uncommitted finalization the review delete
  misses the new review; the run delete then waits and removes the run (and its
  trace). The result is an orphan review. The same race exists today with a wider
  window. Out of scope (§10).
- **Test seams:** `ReviewRunExecutor` is exported (`run-executor.ts:43`) and takes
  the repository in its constructor. `ReviewRepository`'s constructor is public
  (`repository.ts:25-26`). `new Container(config, db, overrides)` is how `buildApp`
  builds it (`app.ts:67`). Integration tests insert repo/PR rows directly
  (`test/reviews.it.test.ts:67-89`). `MockLLMProvider` always returns
  `costUsd: 0.001` (`src/adapters/mocks.ts`), so `null`/`0` cases need an inline
  provider.

### 3.10 Verified vs. assumed

| Claim | Status | Evidence / how it will be checked |
|---|---|---|
| `tx` can be passed to the existing `*.repo.ts` functions | **verified** | scratch typecheck + negative control |
| Transaction = one reserved connection; throw → rollback; nested → savepoint | **verified** (library source) | `drizzle-orm/postgres-js/session.js:96-128` |
| Reused repo functions have no side effects beyond their statement | **verified** (code read) | §3.3 |
| No DB triggers | **verified** | grep in `src/db/migrations` |
| SSE listener cannot throw while events are published | **verified** (code read) | `routes.ts:62-69` (push + resolve only) |
| `cancelRunIfRunning` writes only `status` | **verified** | `run.repo.ts:96` |
| `completeAgentRun` has no callers outside the executor | **verified** | grep |
| `UPDATE` waits on a locked row, then re-checks `WHERE` (READ COMMITTED) | **assumed** (documented Postgres behaviour, not exercised here) | tests R8–R10 |
| An ambiguous commit surfaces as a rejected `begin()` promise | **assumed** (postgres-js behaviour, not verified) | E3/E4 simulate both outcomes; no test can produce a real socket drop at COMMIT |
| Probe wait after a client-side disconnect is bounded | **not guaranteed** | O1 |
| `jsonb` rejects `\u0000`, so it can force a trace-write failure | **assumed** | R5 must first assert that the call rejects; if not, choose another trigger |
| A `Finding` with `title: undefined` violates `NOT NULL` on insert | **assumed** | R4 must first assert that the call rejects |
| pino logging after the commit does not throw | **assumed** | not tested; a throw would land in reconciliation → `noop` → `done` (safe) |

### 3.11 Decisions and open items

- **D1 — approved.** Post-commit events only; the persisted trace does not contain
  them (§3.6).
- **D2 — approved: preserve an already-cancelled run.** `recordRunCancelled` B
  fills metadata without touching `status`, and the trace is insert-only (§3.5).
- **D3 — approved: dedicated conditional operations.** `finalizeDoneRun`,
  `recordRunFailed`, `recordRunCancelled`, `insertRunTraceIfAbsent`,
  `getRunStatus`. `completeAgentRun` is unchanged.
- **D4 — approved: `run.repo.ts`.** One-way imports, no cycle (§3.3).
- **O1 — decided: bounded.** Each reconciliation call (`recordRunFailed`,
  `recordRunCancelled`, `getRunStatus`, `insertRunTraceIfAbsent`) runs in its own
  short transaction with `SET LOCAL lock_timeout` and `SET LOCAL statement_timeout`
  (`RECONCILE_DB_TIMEOUT_MS`, `withLocalTimeouts` in `run.repo.ts`). These end with
  the transaction, so no global or pool setting changes. A client-side deadline
  (`RECONCILE_DEADLINE_MS`) wraps the whole reconciliation, covering connection
  acquisition and a dead socket. A timeout yields `unknown`
  (`Run outcome unknown: …`), never `failed` and never success.
- **O2 — decided: keep `completeAgentRun`** (unchanged, now unused by the executor).
- **O3 — decided: accepted.** Late cancel may drop post-commit success lines from
  the Live Log; a false success status is never published.

## 4. Read paths per surface

### 4.1 Trace drawer: `GET /runs/:id/trace`

- **Query:** no change. `getRunTrace` (`repository/run.repo.ts:183`) returns the
  stored jsonb as is. The route (`reviews/routes.ts:121`) has no response schema, so
  `stats.cost_usd` reaches the client as soon as it has been written.
- **Contract:** `RunStats.cost_usd` (done in Step 1). The executor builds a typed
  `RunTrace` object, so the write in §3 typechecks only with this field.
- **Old traces:** they have no key. The client must treat a missing value the same as `null`.

### 4.2 Run timeline: `GET /pulls/:id/runs` [implemented, Step 3]

- **Query:** `listRunsForPull` (`repository/run.repo.ts`) now reads
  `agent_runs ⟕ agents ⟕ run_traces` in ONE query and selects one extracted column
  instead of the whole document. The jsonb path lives once in
  `src/db/trace-cost.ts` (`traceCostUsd()`), shared with §4.3:

```ts
sql<number | null>`(${t.runTraces.trace} -> 'stats' ->> 'cost_usd')::float8`
```

  - This is a left join, so a run with no trace row yet (still running, or reaped)
    returns `null`.
  - `->>` gives `NULL` for a missing key or a JSON `null`, and casting `NULL` is safe.
- **Contract:** `cost_usd: toCostUsd(row.costUsd)` on every row, so
  `RunSummary.cost_usd` is now `z.number().nullable()` (required) in both
  `vendor/shared` copies.
- **Status filter:** none. Every run row returns its stored value. For non-`done`
  rows the UI shows `—` regardless.

### 4.3 PR list: `GET /repos/:id/pulls` [implemented, Step 4]

- **Query:** `costByPullRequest` (`src/modules/pulls/cost.ts`), one grouped query
  next to the unchanged latest-score query in `src/modules/pulls/routes.ts`. Its
  SQL is equivalent to:

```sql
SELECT ar.pr_id,
       SUM((rt.trace -> 'stats' ->> 'cost_usd')::float8)                 AS cost_usd,
       COUNT(*)                                                           AS done_runs,
       COUNT((rt.trace -> 'stats' ->> 'cost_usd'))                        AS priced_runs
FROM   agent_runs ar
LEFT JOIN run_traces rt ON rt.run_id = ar.id
WHERE  ar.workspace_id = $workspaceId
  AND  ar.pr_id IN ($prIds)
  AND  ar.status = 'done'
GROUP  BY ar.pr_id;
```

- **What counts:** only successful runs, meaning `agent_runs.status = 'done'`.
  - Failed, cancelled, reaped and running runs are excluded.
  - Every agent is included, as is every run in the PR's history, not just the latest one.
- **Calculation:**
  - `SUM` skips nulls, so runs with an unknown cost add nothing.
  - `cost_usd` is `NULL` (→ `null` in JSON) when no `done` run has a known cost, or the PR has no `done` runs.
  - `priced_runs < done_runs` means the total is a lower bound. Expose it as
    `cost_partial: boolean` so the UI can show it as, for example, `≥ $0.42`.
- **What changes the total:**
  - `DELETE /runs/:id` deletes the `agent_runs` row, and its trace goes with it via
    the FK cascade, so the total drops.
  - `DELETE /reviews/:id` leaves the run row in place, so its cost **is still
    counted**. This is intentional, because the money was already spent.
- **Contract:** `PrMeta.cost_usd` and `cost_partial`, both list-only like `score`.
  The list always sends both; a PR with no `done` runs gets
  `{ cost_usd: null, cost_partial: false }` (`NO_COST`).

### 4.4 Summary of required changes

| Area | Change needed? | Step |
|---|---|---|
| DB schema / migrations | **No** | — |
| `saveRunTrace` / `getRunTrace` | No (reused inside the transaction) | — |
| `finalizeDoneRun` (new, transactional; §3.3) | Yes | 2 |
| Failure-path terminal writes (status guard; §3.5) | Yes | 2 |
| `run-executor.ts` (write `stats.cost_usd`, call `finalizeDoneRun`) | Yes | 2 |
| `listRunsForPull` query | Done (LEFT JOIN + jsonb extract) | 3 |
| PR list route | Done (one extra aggregate query) | 4 |
| `RunStats`, `RunSummary`, `PrMeta` in **both** `vendor/shared` copies | Done | 1 |
| `RunSummary.cost_usd` required-nullable | Done | 3 |
| New endpoints | No | — |

## 5. Contract changes [implemented, Step 1]

Identical in **both** `server/src/vendor/shared/contracts/` and
`client/src/vendor/shared/contracts/`:

- `RunStats.cost_usd: z.number().finite().nonnegative().nullable().optional()`. It is
  optional because old trace documents have no key. Nothing parses a trace at
  runtime today: `buildRunTrace` (`src/platform/trace-builder.ts:37`) is the only
  `RunTrace.parse` call and has no callers.
- `RunSummary.cost_usd: z.number().nullable()` (required since Step 3: the runs
  endpoint always sends it).
- `PrMeta.cost_usd: z.number().nullable().optional()` and
  `PrMeta.cost_partial: z.boolean().optional()`. Both are returned by the list endpoint only.

`null` or a missing value always means "unknown" and must never be shown as `$0.00`.
The client does not run Zod over these responses (the hooks just cast the types), so
the contract update is for typing and keeping the two copies in sync, not for
runtime validation.

## 6. Technical limitations of Option B

1. **Cost depends on the trace write.**
   - **Today:** `completeAgentRun('done')` runs first (`run-executor.ts:243`) and
     `saveRunTrace` comes later (`:286`). In between, the run is already `done` but
     its cost reads as `null`. `runBus.complete` fires after the trace is saved, so
     a client that refetches on SSE `done` won't see that gap. A poller might.
   - **With §3.3:** `done` and the trace commit in one transaction, so the gap is
     gone. Cost is still only as durable as the trace document.
2. **[potential bug, addressed by §3.3 + §3.5] A failed trace write turns success into failure.**
   - **Today:** if `saveRunTrace` throws on the success path, the `catch` block
     (`run-executor.ts:290`) overwrites the status `done` with `failed`, and the
     review and findings already written stay attached to that `failed` run.
   - **With §3.3/§3.5:** the trace write is inside the transaction, so a failure
     rolls back the claim, review, findings and `last_reviewed_sha`. The run ends
     `failed` with no review (§3.8). The guarded failure path (§3.5–§3.7) can no
     longer overwrite a committed `done` or its trace, even after an ambiguous commit.
   - Cost still lives in the trace document, so a failed trace write still loses the
     cost (the run is `failed`, and failed runs record no spend, §6.6).
3. **Reading jsonb is heavier than reading a column.**
   - The trace contains the full prompt assembly, the raw output and the log.
     Extracting `stats.cost_usd` makes Postgres de-TOAST the whole document for each row.
   - This is fine for one PR's timeline, and for a PR-list page of tens of PRs.
   - It won't scale to cross-repo dashboards (L07/L08) without a column or an
     expression index, and either of those needs a migration.
4. **No type safety in SQL.**
   - The path `'stats' ->> 'cost_usd'` is a string literal. A rename in the
     contract won't break the query at compile time; only the tests in §8 catch it.
   - A value that is not a number makes the `::float8` cast fail and the whole list request return a 500.
   - Only the executor writes this field. Keep it that way.
5. **Old runs have no cost.** Runs recorded before the change have no key and read
   as `null`. There is nothing to backfill from: the trace document never contained a cost.
6. **Failed and cancelled runs show no spend.** That is a limitation of §1.5 that
   Option B inherits. The PR total is therefore "spend on successful runs", not total spend.
7. **[potential bug, status overwrite addressed by §3.3/§3.4] A cancel can be overwritten by `done`.** See [../INSIGHTS.md](../INSIGHTS.md).
   - **Today:** such a run ends up `done` with a cost and is counted in the PR
     total even though the user cancelled it. The status filter in §4.3 trusts
     `agent_runs.status`.
   - **With §3.3:** the claim `WHERE status = 'running'` cannot overwrite
     `cancelled`, so a cancelled run never gets a review or a success trace and
     never enters the PR total.
   - **Still open:** `runBus.complete` clears the cancel flag (`sse.ts:79`), so the
     runner keeps calling the LLM after a cancel. That spend is discarded, not
     recorded (§10).
8. **OpenAI and Anthropic costs are estimates.** They come from the static
   "approximate" table, so the UI should label them as estimates. OpenRouter costs
   are billed values whenever `usage.cost` was returned.
9. **The PR list refreshes slowly.** The list is refetched on its own interval
   (about 60 s on the client) and does not react to runs finishing, so a new run
   appears in the PR total with a delay.

## 7. L01 UI requirements (what the server supplies)

| Surface | Client location (reference) | Display | Server field |
|---|---|---|---|
| **PR list** | `client/src/app/repos/[repoId]/pulls/` | Total cost of successful runs, e.g. `$0.42`; `≥ $0.42` when `cost_partial`; `—` when `null` | `PrMeta.cost_usd`, `PrMeta.cost_partial` |
| **Run timeline** | `RunHistory` component | Badge per run; `—` for running, failed or cancelled runs and for `null` | `RunSummary.cost_usd` |
| **Trace drawer** | `TraceBody` stats row, next to duration and tokens | "Cost" stat: `$x.xx`, or `n/a` when `null` or missing (same as the removed `formatCost`) | `RunTrace.stats.cost_usd` |

The client does all formatting (one `formatCost` in `client/src/lib/format.ts`;
rules in the client spec §1). The server returns raw USD floats.

## 8. Acceptance criteria

1. A successful run stores reviewer-core's `costUsd` unchanged in `run_traces.trace.stats.cost_usd`.
2. When reviewer-core returns `costUsd: null`, the stored value and every API value are `null`, not `0`.
3. Failed, cancelled and pre-work-failed runs store `stats.cost_usd: null`. Reaped
   runs have no trace and read as `null`.
4. `GET /runs/:id/trace` returns `stats.cost_usd` for new runs. Old traces without the key still load.
5. `GET /pulls/:id/runs` returns `cost_usd` on every `RunSummary`, using one query
   with a LEFT JOIN on `run_traces`, not N+1 trace reads.
6. `GET /repos/:id/pulls` returns, per PR:
   - `cost_usd` = the sum over `status='done'` runs with a known cost, or `null` when there is none;
   - `cost_partial = true` when at least one `done` run has no known cost.
7. No file under `server/src/db/schema/` or `server/src/db/migrations/` changes.
8. Both `vendor/shared` copies gain the same fields, and
   `diff -rq server/src/vendor/shared client/src/vendor/shared` shows no new differences.
9. `pnpm typecheck` passes, as do the server unit and integration lanes (integration
   wherever Docker is available) and the reviewer-core tests.
10. (Step 2) A run is `done` **iff** its review, findings, `last_reviewed_sha`
    update and trace (with `stats.cost_usd`) were committed in the same transaction.
    No `done` run is visible without its trace.
11. (Step 2) If any write in `finalizeDoneRun` fails and the transaction did not
    commit, none of the writes persist, and the run ends `failed` with the error
    message and no review row for its `run_id`.
12. (Step 2) A run that is `cancelled` before the claim never becomes `done` and has
    no review row for its `run_id`. Its `status` is never rewritten; only `error`
    and `duration_ms` are filled in, once, when still `NULL`.
13. (Step 2) A run that is `done` is never changed by the failure or cancel path,
    including after an ambiguous commit, and its trace is never overwritten.
14. (Step 2) No `Persisted review…` / `Run complete…` event and no
    `runBus.complete` from the executor is published before the commit. The
    persisted trace log does not contain those two lines. The terminal error event
    is published only after the guarded write, and matches its result.

## 9. Test scenarios

| # | Lane | Scenario | Expectation |
|---|---|---|---|
| T1 | integration (`test/reviews.it.test.ts` style) | `MockLLMProvider` (cost 0.001), one agent, then `waitForPrRuns` | `runs[0].cost_usd === 0.001`; `trace.stats.cost_usd === 0.001` |
| T2 | integration | inline `LLMProvider` with `costUsd: null` | `cost_usd === null` in the run list and in the trace; PR `cost_usd === null`, `cost_partial === true` |
| T3 | integration | provider key missing, so the run is `failed` | run `cost_usd === null`; PR total excludes it |
| T4 | integration | two `done` runs (0.001 each) and one `failed` run on one PR | `PrMeta.cost_usd ≈ 0.002` (float compare); `cost_partial === false` |
| T5 | integration | PR with no runs | `PrMeta.cost_usd` is `null` or absent |
| T6 | integration | trace row inserted by hand without `stats.cost_usd` (an old run) | the run lists with `cost_usd: null`, no 500 |
| T7 | integration | `DELETE /runs/:id` for one priced run | the PR total drops by that run's cost |
| T8 | unit (`test/contracts.test.ts`) | `RunStats` / `RunSummary` / `PrMeta` with cost as a number, as `null`, and missing | all parse |
| T9 | reviewer-core unit | two chunks, one with `null` cost | `outcome.costUsd === null` (regression guard) |
T1–T3 assert on the trace in Step 2 and on the run list in Step 3; T2's and T4–T7's
PR-list assertions belong to Step 4.

### 9.1 Step 2 tests (all DB-backed → `*.it.test.ts`, integration lane, Docker)

**Repository level — new `test/run-finalize.it.test.ts`.** Fixtures: `startPg` +
`seed`, repo/PR rows inserted as in `test/reviews.it.test.ts:67-89`, run rows via
`createAgentRun`. Every "nothing persisted" check covers: `agent_runs.status`,
`reviews WHERE run_id`, `findings` of those reviews, `pull_requests.last_reviewed_sha`,
`run_traces WHERE run_id`.

| # | Scenario | Expectation |
|---|---|---|
| R1 | `finalizeDoneRun` on `running`, trace `cost_usd: 0.001` | `finalized: true`; run `done` with the completion columns; 1 review with `run_id`; findings count = input; `last_reviewed_sha` = sha; `trace.stats.cost_usd === 0.001` |
| R2 | same with `cost_usd: null` | trace has the key: `toHaveProperty('stats.cost_usd', null)` |
| R3 | same with `cost_usd: 0` | `trace.stats.cost_usd === 0` (known zero, not `null`) |
| R4 | rollback at step 3: one finding with `title: undefined` (NOT NULL) | first asserts the call **rejects** (assumption, §3.10); then nothing persisted, status still `running` |
| R5 | rollback at step 5: trace `raw_output` contains `\u0000` | first asserts the call **rejects** (assumption, §3.10); then nothing persisted, status still `running` |
| R6 | `cancelRunIfRunning` first, then `finalizeDoneRun` | `finalized: false, currentStatus: 'cancelled'`; nothing persisted; status `cancelled` |
| R7 | `deleteAgentRun` first, then `finalizeDoneRun` | `finalized: false, currentStatus: null`; no review, no trace |
| R8 | claim holds the lock, then commits: `db.transaction(async tx => { await finalizeDoneRun(tx, …); p = cancelRunIfRunning(db, runId); assert p still pending after 200 ms })` (nested → savepoint, verified) | after commit `p` resolves `false`; status `done`; review + trace present |
| R9 | as R8, but the outer callback throws after the 200 ms check | rollback; `p` resolves `true`; status `cancelled`; nothing else persisted |
| R10 | 20 iterations of `Promise.all([finalizeDoneRun, cancelRunIfRunning])` on fresh runs | every iteration ends in exactly one consistent state: (`done` + review + trace + cancel `false`) or (`cancelled` + no review + no trace + cancel `true`) |
| R11 | `recordRunFailed` on `running` | `'transitioned'`; status `failed`, `error` set; then `insertRunTraceIfAbsent` → `true`, `stats.cost_usd === null` |
| R12 | `recordRunFailed` on `done` (after R1-style finalize) | `'noop'`; status, columns and trace (`cost_usd === 0.001`) unchanged |
| R13 | `recordRunFailed` on `cancelled` | `'noop'`; status `cancelled` |
| R14 | `recordRunCancelled` on `running` / on `cancelled` with `error IS NULL` / again / on `done` | `'transitioned'` / `'annotated'` (status unchanged, `error = 'Cancelled by user'`, `duration_ms` set) / `'noop'` / `'noop'` |
| R15 | `insertRunTraceIfAbsent` when a trace exists | `false`; stored document unchanged |
| R16 | `insertRunTraceIfAbsent` for a deleted run | rejects (FK) — documents why callers must catch |

**Executor level — new `test/run-executor-finalize.it.test.ts`.** Uses
`new Container(config, db, overrides)` (as `app.ts:67`) and
`new ReviewRunExecutor(container, repo, container.agentsRepo)` where `repo` is a
subclass of `ReviewRepository` overriding `finalizeDoneRun` (§3.9 test seams).
Providers: `MockLLMProvider` for `0.001`; an inline provider for `null` and `0`.

| # | Scenario | Expectation |
|---|---|---|
| E1 | full run, cost `0.001` / `null` / `0` | trace `stats.cost_usd` equals the provider's value, with the key present for `null` |
| E2 | override records `runBus.buffer(runId)` messages and `runBus.isComplete(runId)` on entry, then calls `super` | on entry: no `Persisted review…`, no `Run complete…`, `isComplete === false`. After `executeRuns`: both lines present in the buffer, after the entry snapshot. Persisted trace log contains neither (D1) |
| E3 | ambiguous commit, committed: `await super.finalizeDoneRun(i); throw new Error('connection reset')` | status `done`; exactly 1 review; trace `cost_usd === 0.001` (not overwritten); no `Run failed…` event; `Run complete (confirmed…)` event; `isComplete === true` |
| E4 | ambiguous commit, not committed: throw **before** `super` | status `failed` with the message; 0 reviews; trace from buffer with `cost_usd === null` that contains the `Run failed…` line |
| E5 | lost race to cancel: `cancelRunIfRunning` inside the override, then `super` | status stays `cancelled`; `error = 'Cancelled by user'`, `duration_ms` set; trace inserted with `cost_usd === null`; 0 reviews; no success events |
| E6 | runner sees the cancel flag (`runBus.cancel` before the run reaches `checkCancelled`) | status `cancelled` via `recordRunCancelled` A or B; trace `cost_usd === null` |
| E7 | pre-work failure (`MockGitClient` diff throws) | every queued run `failed` (guarded) with a buffer trace, `cost_usd === null` |

**Executor control flow without a DB — `test/run-executor-reconcile.test.ts`
(unit lane).** A faked repository pins the event order and which guarded
operation runs for: post-commit success, `null`/`0` cost, both ambiguous-commit
outcomes, lost claim to cancel, the runner seeing the flag, failure after a user
cancel, a missing row, a reaped row, a probe rejected by `lock_timeout`, a hanging
probe cut by the deadline, and pre-work failure.

**Not covered by tests (stated, not hidden):** a real socket drop during `COMMIT`
(E3/E4 only simulate both outcomes); an unbounded probe wait (O1); a pino throw
after the commit.

## 10. Out of scope

- Recording spend for failed or cancelled runs (§1.5). That needs partial usage
  reported when a provider throws, which is a reviewer-core change.
- ~~Fixing the cancel/overwrite race and the trace-failure flip (§6.2, §6.7).~~
  **Moved into Step 2 by §3.3–§3.7** (status overwrite, partial success writes,
  ambiguous commit), pending implementation approval. Still out of scope:
  - the cancel flag being cleared by `runBus.complete` (`sse.ts:79`), so a live
    runner keeps spending after a cancel;
  - the `deleteAgentRun` vs. in-flight finalization race (§3.9);
  - the Live Log gap after a late cancel (O3, §3.11);
  - the boot reaper and multi-instance ownership (INSIGHTS 2026-10-11).
- Per-agent cost and dashboard cost aggregates (L07/L08). These would bring back the
  question of a column (§2).

## 11. Implementation steps

| Step | Content | Status |
|---|---|---|
| 1 | Shared contracts in both `vendor/shared` copies (§5), all new fields optional | done |
| 2 | Write path: `stats.cost_usd` (§3.1), `finalizeDoneRun` (§3.3), terminal operations (§3.5), executor ordering (§3.6–§3.7); tests R1–R16, E1–E7 (§9.1) + trace parts of T1–T3 | done; R1–R16 + E1–E7 pass on Testcontainers Postgres (2026-10-11) |
| 3 | `listRunsForPull` LEFT JOIN (§4.2); `RunSummary.cost_usd` required-nullable in both copies | done; `test/run-cost-api.it.test.ts` |
| 4 | PR-list aggregate, `cost_usd` + `cost_partial` (§4.3) | done; `test/pulls-cost.test.ts`, `test/run-cost-api.it.test.ts` |
| 5 | Client formatting, UI and cache refresh (§7, client spec §1) | done; client unit/component tests |

Test mapping: T1–T7 → `test/run-cost-api.it.test.ts` (plus known-zero and
running-run cases); T8 → `test/contracts.test.ts` ("L01 cost contracts"); T9 →
`reviewer-core/test/run.test.ts` ("costUsd across map-reduce chunks").

The end-to-end run flow is described in [../docs/architecture.md](../docs/architecture.md).
