# Spec: review run cost (L01, server side)

- **Status:** decided, not implemented. Storage is **Option B**: cost lives in
  `run_traces.trace.stats.cost_usd` (jsonb). No schema change, no migration.
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
   - `RunStats`, `RunSummary` (`src/vendor/shared/contracts/trace.ts:61,94`) and
     `PrMeta` (`src/vendor/shared/contracts/platform.ts:157`) have no cost field.
     The client copies don't either.
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

## 3. Write path [proposal]

- **Successful run** (`run-executor.ts:255-286`):
  - destructure `costUsd` from the outcome next to `tokensIn` and `tokensOut`;
  - write `stats.cost_usd: costUsd` into the trace (a number, or `null` when unknown).
- **Failed, cancelled or pre-work failure** (`traceFromBuffer`, `run-executor.ts:408-432`):
  write `stats.cost_usd: null`.
- **Unchanged:** `completeAgentRun` and the `agent_runs` columns.
- **Value:** store reviewer-core's figure exactly as returned. Do not re-estimate,
  round or format it.

## 4. Read paths per surface

### 4.1 Trace drawer: `GET /runs/:id/trace`

- **Query:** no change. `getRunTrace` (`repository/run.repo.ts:183`) returns the
  stored jsonb as is. The route (`reviews/routes.ts:121`) has no response schema, so
  `stats.cost_usd` reaches the client as soon as it has been written.
- **Contract:** add `cost_usd` to `RunStats`. The executor builds a typed `RunTrace`
  object, so without the field the write in §3 does not typecheck.
- **Old traces:** they have no key. The client must treat a missing value the same as `null`.

### 4.2 Run timeline: `GET /pulls/:id/runs`

- **Query: change needed.**
  - Today `listRunsForPull` (`repository/run.repo.ts:40-68`) reads only `agent_runs ⟕ agents`.
  - Add `LEFT JOIN run_traces ON run_traces.run_id = agent_runs.id`.
  - Select one extracted column instead of the whole document:

```ts
costUsd: sql<number | null>`(${t.runTraces.trace} -> 'stats' ->> 'cost_usd')::float8`
```

  - This is a left join, so a run with no trace row yet (still running, or reaped)
    returns `null`.
  - `->>` gives `NULL` for a missing key or a JSON `null`, and casting `NULL` is safe.
- **Contract:** add `cost_usd` to `RunSummary`, and map `cost_usd: row.costUsd` in the row mapping.
- **Status filter:** none. Every run row returns its stored value. For non-`done`
  rows the UI shows `—` regardless.

### 4.3 PR list: `GET /repos/:id/pulls`

- **Query: change needed**, as a second aggregate query next to the existing
  latest-score query in `src/modules/pulls/routes.ts:114-130`, which already does
  one `IN (...)` query over `prIds`. The new query should not change the score logic.

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
- **Contract:** add `cost_usd` and `cost_partial` to `PrMeta`, both list-only like `score`. Map them in the `rows.map(...)` at `pulls/routes.ts:133-157`.

### 4.4 Summary of required changes

| Area | Change needed? |
|---|---|
| DB schema / migrations | **No** |
| `saveRunTrace` / `getRunTrace` | No |
| `run-executor.ts` (write `stats.cost_usd`) | Yes |
| `listRunsForPull` query | Yes (LEFT JOIN + jsonb extract) |
| PR list route | Yes (one extra aggregate query) |
| `RunStats`, `RunSummary`, `PrMeta` in **both** `vendor/shared` copies | Yes |
| New endpoints | No |

## 5. Contract changes [proposal]

Make the same edits in **both** `server/src/vendor/shared/contracts/` and
`client/src/vendor/shared/contracts/`:

- `RunStats.cost_usd: z.number().nullable().optional()`. It is optional because
  old trace documents have no key.
- `RunSummary.cost_usd: z.number().nullable()`
- `PrMeta.cost_usd: z.number().nullable().optional()` and
  `PrMeta.cost_partial: z.boolean().optional()`. Both are returned by the list endpoint only.

`null` or a missing value always means "unknown" and must never be shown as `$0.00`.
The client does not run Zod over these responses (the hooks just cast the types), so
the contract update is for typing and keeping the two copies in sync, not for
runtime validation.

## 6. Technical limitations of Option B

1. **Cost depends on the trace write.**
   - On success, `completeAgentRun('done')` runs first (`run-executor.ts:243`) and
     `saveRunTrace` comes later (`:286`).
   - In between, the run is already `done` but its cost reads as `null`.
   - `runBus.complete` fires after the trace is saved, so a client that refetches
     on SSE `done` won't see that gap. A poller might.
2. **[potential bug] A failed trace write turns success into failure.**
   - If `saveRunTrace` throws on the success path, the `catch` block
     (`run-executor.ts:290`) overwrites the status `done` with `failed`.
   - Cost still lives in that same document, so it is lost along with the trace.
   - This is existing behaviour; Option B just puts the cost in the same failure domain.
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
7. **[potential bug] A cancel can be overwritten by `done`.** See [../INSIGHTS.md](../INSIGHTS.md).
   - Such a run ends up `done` with a cost and is counted in the PR total even though the user cancelled it.
   - The status filter in §4.3 trusts `agent_runs.status`.
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

The client does all formatting. The server returns raw USD floats.

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

## 10. Out of scope

- Recording spend for failed or cancelled runs (§1.5). That needs partial usage
  reported when a provider throws, which is a reviewer-core change.
- Fixing the cancel/overwrite race and the trace-failure flip (§6.2, §6.7).
- Per-agent cost and dashboard cost aggregates (L07/L08). These would bring back the
  question of a column (§2).

The end-to-end run flow is described in [../docs/architecture.md](../docs/architecture.md).
