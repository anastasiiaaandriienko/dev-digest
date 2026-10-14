# Spec: review pipeline (reviewer-core)

- **Status:** §1–§3 describe **existing** behaviour, verified against source on
  2026-10-11. §4 lists **proposed** changes; none of them is implemented.
- **Mechanics:** how each step works is in [../docs/architecture.md](../docs/architecture.md).
  This page states only what must hold, and how to test it.

Labels:
- **[existing]**: current behaviour, with an evidence reference;
- **[gap]**: current behaviour that is not covered by any test;
- **[proposed]**: a change that is not implemented;
- **[potential bug]**: found by reading the code, not reproduced.

## 1. Contract of `reviewPullRequest`

**[existing]** Given a `ReviewInput` (`src/review/run.ts:44-93`), it resolves to a
`ReviewOutcome` (`run.ts:95-113`) or rejects. It rejects in two cases:
1. `checkCancelled` throws;
2. any `llm.completeStructured` call throws, including when the repair budget runs out.

There is no partial result: work from the chunks that already finished is thrown away.

**Side effects.** The engine has none except calls to `input.llm` and
`input.onEvent`. It does not touch the DB, the filesystem, the environment or the
clock in a way that affects the result.

## 2. Invariants (existing behaviour)

| ID | Invariant | Evidence | Tested? |
|---|---|---|---|
| I1 | Every `review.findings[i]` passed `groundFindings` against `input.diff`: the file is in the diff, **and** the line range intersects an indexed new-side line, unless `kind` is one of the full-file kinds. | `run.ts:197`, `grounding.ts:52-84` | yes (`test/run.test.ts`, `server/test/grounding.test.ts`) |
| I2 | `review.score === scoreFromFindings(review.findings)`, whatever score the model returned | `run.ts:208`, `reduce.ts:27-30` | partly (only the 0-findings ⇒ 100 case) |
| I3 | `grounding === "${kept}/${kept+dropped} passed"`, and `dropped` holds every removed finding with a reason | `grounding.ts:87-90`, `run.ts:198-201` | yes |
| I4 | The system message always ends with `INJECTION_GUARD`; every untrusted slot that is present is wrapped in `<untrusted source=…>`; the diff section is always last | `prompt.ts:86-120` | yes (`test/prompt.test.ts`, `server/test/prompt-callers.test.ts`) |
| I5 | A literal `</untrusted>` inside wrapped content is escaped | `prompt.ts:32` | yes (server tests) |
| I6 | Mode: `single-pass` gives exactly 1 LLM call; `map-reduce` gives 1 call per file when there are more than 1 file, otherwise 1; `auto` (the default) gives map-reduce only when changed lines > `mapThresholdLines` (400) **and** there are more than 1 file | `run.ts:115-121` | **[gap]** only single-pass is tested |
| I7 | `checkCancelled` runs before **every** LLM call. A throw stops the run, and no later call happens. | `run.ts:164` | single-pass only |
| I8 | `tokensIn`/`tokensOut` are the sums over all chunks. `costUsd` is the sum, or `null` if any chunk's cost was `null`. | `run.ts:182-184` | **[gap]** |
| I9 | Map-reduce merge: findings are concatenated without deduplication, and the worst verdict wins (`request_changes > comment > approve`) | `reduce.ts:43-55` | **[gap]** |
| I10 | `review.verdict` is the model's own (the merged one in map-reduce). It is **not** made consistent with the score or the findings. | `run.ts:208` | implicit |
| I11 | When `sessionId` is set, it is forwarded on every `completeStructured` request | `run.ts:180` | single-pass only |
| I12 | Every call uses `schema: Review`, `schemaName: 'Review'` and `maxRetries` (default 2) | `run.ts:174-181` | indirect |
| I13 | Events are emitted in order: mode line → per chunk (`tool`, then `result`) → reduce line → one line per dropped finding → grounding summary | `run.ts:149-202` | partly |
| I14 | `prDescription` is cut to 4000 characters and left out when it is blank | `prompt.ts:37,99-102` | yes |

**Default path in production.** The server calls the engine with
`strategy = agent.strategy`. That column defaults to `'single-pass'`, so I6's
map-reduce branch runs only when an agent was switched to `auto` or `map-reduce`.

## 3. Known limitations (existing behaviour, accepted for now)

1. **[potential bug]** `sliceDiff` matches file headers by substring, so a chunk
   can include a file whose name starts with the same text (`a.ts` vs `a.tsx`).
   Its fallback returns headers without hunks (`reduce.ts:58-72`).
2. **Grounding accepts context lines.** The server's diff parser indexes context
   lines as well as added ones, so a finding on an unchanged line inside a hunk passes I1.
3. **`kind` is chosen by the model.** A model that labels an ordinary finding with
   a full-file kind (for example `secret_leak`) gets past the line check.
4. **I10:** the verdict can contradict the score. The server uses deterministic
   blockers (`countBlockers`) for the run status.
5. **Dropped findings are not persisted.** `ReviewOutcome.dropped` is returned,
   but the server only logs it.
6. **A failing chunk loses earlier usage.** Tokens and cost of the chunks that
   already succeeded are discarded.

## 4. Proposed changes [proposed — not implemented]

| ID | Change | Rationale | Notes |
|---|---|---|---|
| P1 | Add tests for I6, I8 and I9 (map-reduce, null-cost propagation, merge rules) and widen the I2 tests | These paths are reachable from the Agent editor but have no tests | test-only; no behaviour change |
| P2 | Make `sliceDiff` match the exact `b/<path>` header token, and build the fallback from `file.hunks` | Fixes limitation 1 | behaviour change only in map-reduce |
| P3 | Return `partialUsage { tokensIn, tokensOut, costUsd }` on the error thrown when a chunk fails (a `ReviewRunError` that wraps the cause) | Lets the server show real spend for failed runs (see [../../server/specs/review-run-cost.md](../../server/specs/review-run-cost.md) §1.5) | the server has to read it; cancellation stays caller-owned |
| P4 | Only accept a full-file `kind` from callers that run full-file scanners; for LLM output, treat it as `finding` | Fixes limitation 3 | needs a decision: current lessons (L06) rely on these kinds |
| P5 | Add an optional `phase` to emitted events (`data.phase`, 1–5) | Supports the L01 phase stepper ([../../client/specs/l01-review-ui.md](../../client/specs/l01-review-ui.md) §2) | only covers the core-emitted phases 4–5; the server emits 1–3 |

None of these changes requires a DB migration. P3 and P5 also need matching
changes in the server, and P5 needs a contract change in both `vendor/shared` copies.

## 5. Acceptance criteria

**For the existing behaviour.** These form a regression gate for any change to `src/`:
1. I1–I14 hold. Each one is backed by at least one test in `reviewer-core/test`
   or by the listed server test.
2. `npm run typecheck` and `npm test` pass in `reviewer-core/`. Server unit tests
   pass too, because the server type-checks this source.
3. No new import of `fs`, `child_process` or a DB/HTTP client appears under `src/`,
   other than the existing `openai` SDK and `fetch` in `OpenRouterProvider`.
4. The public surface in `src/index.ts` changes only on purpose, and every export
   added or removed is listed in the change.

**For the proposals, if accepted:**
5. P1: map-reduce, null-cost and merge tests exist and pass, with no change to `src/` behaviour.
6. P2: a diff containing `src/a.ts` and `src/a.tsx` yields two chunks, each with only its own file.
7. P3: when a chunk fails after an earlier one succeeded, the rejection carries the
   earlier tokens and cost, and `checkCancelled` errors are rethrown unchanged.

## 6. Test scenarios

| # | Invariant | Setup | Expectation |
|---|---|---|---|
| T1 | I1, I3 | `MockLLMProvider` with one in-hunk and one off-hunk finding (existing test) | 1 kept, 1 dropped, grounding `1/2 passed` |
| T2 | I2 | Fixture with 1 CRITICAL + 1 WARNING + 2 SUGGESTION, all grounded, model score 99 | `score === 47` |
| T3 | I2 | 3 CRITICAL, grounded | `score === 0` (clamped) |
| T4 | I6 | `strategy:'auto'`, 2 files, 400 changed lines | 1 call, `mode === 'single-pass'` |
| T5 | I6 | `strategy:'auto'`, 2 files, 401 changed lines | 2 calls, `mode === 'map-reduce'`, `chunks` = the file paths |
| T6 | I6 | `strategy:'map-reduce'`, 1 file | 1 call, `mode === 'single-pass'` |
| T7 | I8 | Inline provider returning costs `0.01` and `null` over 2 chunks | `costUsd === null`, tokens added up |
| T8 | I8 | Costs `0.01` + `0.02` | `costUsd ≈ 0.03` |
| T9 | I9 | Chunk verdicts `approve` + `request_changes`, 1 finding each | verdict `request_changes`, 2 findings (before grounding) |
| T10 | I7 | Map-reduce over 2 files; `checkCancelled` throws on its 2nd call | rejects; exactly 1 LLM call made |
| T11 | I4, I5 | `repoMap` containing `</untrusted>` | the escaped form appears; the diff section is still last |
| T12 | I13 | Collect events from T1 | order: mode, tool, result, reduce, dropped, grounding |
| T13 | I1 / limitation 2 | Finding on a context line inside a hunk | kept (documents current behaviour) |
| T14 | P2 | Diff with `src/a.ts` + `src/a.tsx`, `sliceDiff(diff,'src/a.ts')` | today: contains both (**fails after P2**); after P2: only `a.ts` |
| T15 | I11 | Map-reduce over 2 files with `sessionId` | both calls carry it |

For mocks and fixtures, see [../docs/testing.md](../docs/testing.md).
