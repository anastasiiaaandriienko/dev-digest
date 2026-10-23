# Plan: L06 — Eval Pipeline

- **Spec:** `specs/eval-pipeline.md` (Key EVAL) · **Status:** Draft — awaiting approval (G1 spec, G2 plan)
- **Rules:** one stage at a time; package checks run **sequentially** (never parallel); no install, no lockfile edit,
  no `db:migrate`, no paid LLM call without explicit approval; no commit.
- **Surface (kept minimal):** 1 new table, 6 NULLable columns, 6 endpoints, 1 new page, 1 new tab, 1 card button + modal.

Legend: **APPROVAL REQUIRED** = protected action (AGENTS.md "Do not touch").

---

## Stage 1 — Data model and migration
- **Files:** `server/src/db/schema/eval.ts` (4 columns on `eval_cases`, 2 on `eval_runs` — all NULLable, no default;
  new `agentEvalRuns` table; indexes) · `server/src/db/rows.ts` (`EvalCaseRow`, `EvalRunRow`, `AgentEvalRunRow`) ·
  `server/src/db/migrations/0015_*.sql` + `meta/0015_snapshot.json` + `_journal.json` (generated).
- **APPROVAL REQUIRED:** schema change; running `pnpm db:generate`. The user applies `pnpm db:migrate` themselves.
- **Checks:** `cd server && pnpm typecheck`; SQL review against spec §5 contract — allowed statements only
  (`CREATE TABLE`, `ADD COLUMN` without `NOT NULL`/`DEFAULT`, `ADD CONSTRAINT FOREIGN KEY`, `CREATE [UNIQUE] INDEX`);
  any `DROP`/`RENAME`/`ALTER COLUMN`/`UPDATE`/`DELETE` or unrelated drift → stop and report.
- **Done when:** SQL matches §5 exactly; typecheck green. AC 36 (SQL part).

## Stage 2 — Contracts, module skeleton, persistence
- **Files:** `server/src/vendor/shared/contracts/eval-ci.ts` + `client/src/vendor/shared/contracts/eval-ci.ts`
  (identical appended block between `// L06-EVAL:BEGIN` / `// L06-EVAL:END` markers) · both `contracts/review-api.ts`
  (`eval_case_id`) · `server/src/modules/evals/{routes.ts,service.ts,repository.ts,eval-case.repo.ts,eval-run.repo.ts,helpers.ts,constants.ts}` ·
  `server/src/modules/index.ts` (register).
- **Skills:** onion-architecture, fastify-best-practices, zod, drizzle-orm-patterns.
- **Tests:** `server/test/eval-helpers.test.ts` (unit). **Checks:** server typecheck + unit; then client typecheck.
- **Done when:** `GET /agents/:id/eval-cases`, `GET /agents/:id/eval-runs` return `[]`, workspace-scoped; strict inputs. ACs 07, 30 (design).

## Stage 3 — Finding → eval case
- **Files:** `evals/service.ts` (`createFromFinding`), `evals/helpers.ts` (label, slug/dedup name, `inputHash`,
  location-in-diff via `groundFindings`, width check, duplicate/conflict check) · reuse `reviews/diff-loader.ts`
  `loadDiff` and `review.repo.ts` `findingContext` (import, no copy) · `server/src/modules/reviews/helpers.ts` + review
  list query (left join `eval_cases` on `source_finding_id` for `eval_case_id`).
- **Tests:** unit helpers; integration ACs 01-08 in `server/test/evals.it.test.ts` (written now, **run only with approval**).
- **Done when:** ACs 01-08 (unit parts green locally).

## Stage 4 — Deterministic scoring
- **Files:** `server/src/modules/evals/scoring.ts` (pure: normalize, overlap, width rule, Kuhn matching, closed-world
  FP with reasons, verdicts, aggregates, citation via `groundFindings`).
- **Tests:** `server/test/eval-scoring.test.ts` — one table test per §8 rule; greedy-vs-maximum counter-example;
  §8.4 spam example (precision must fall from 0.71 to 0.30); zero denominators; shuffle determinism; re-score from stored output.
- **Done when:** ACs 14-20, 35 green.

## Stage 5 — Eval runner
- **Files:** `server/src/modules/evals/runner.ts` (group by `input_hash`, sequential engine calls, persist case rows,
  guarded finalize) · `evals/service.ts` (`startRun`: snapshot from the `agents` row + frozen skills via
  `effectiveSkills`/`planSkills`, limits, one-running check in a transaction, 202, `void execute().catch`) · boot reaper
  next to existing reapers in `server/src/app.ts` · `server/src/adapters/mocks.ts` (widen `MockLLMProvider` id to
  include `'openrouter'` — **APPROVAL REQUIRED**, test adapter).
- **Read first:** `server/INSIGHTS.md` (jobs retries, guarded terminal writes).
- **Tests:** `server/test/eval-runner.test.ts` (unit, mock LLM, fake repo: one call per group, excluded inputs, failure →
  failed + null metrics); integration ACs 09-13, 21-22.
- **Done when:** a mocked run goes `running → done` with the expected metrics.

## Stage 6 — History and comparison API
- **Files:** `evals/service.ts` (`listRuns`, `getRun`, `compare`), `evals/helpers.ts` (`compareRuns`, pure).
- **Tests:** unit `compareRuns` (fixed/regressed/only_*, prompt_changed, config_changes, same_case_set); integration ACs 23, 25, 27.
- **Done when:** ACs 23, 25, 27.

## Stage 7 — Client: hooks + FindingCard
- **Files:** `client/src/lib/hooks/evals.ts` (+ `index.ts` barrel): `useAgentEvalCases`, `useCreateEvalCase`,
  `useAgentEvalRuns`, `useEvalRun` (polls 2 s while running), `useStartEvalRun`, `useEvalCompare` ·
  `pulls/[number]/_components/FindingCard/FindingCard.tsx` (+ styles, test) · new
  `pulls/[number]/_components/AddToEvalModal/` (component, index, `helpers.ts` with `findingToSeed`, styles, test) ·
  hook mocks in `DiffTab.test.tsx`, `FindingsPanel.test.tsx`, `ReviewRunAccordion.test.tsx`, `InlineFinding.test.tsx` ·
  `client/messages/en/prReview.json`.
- **Skills:** frontend-architecture, react-best-practices, react-testing-library.
- **Checks:** `cd client && pnpm typecheck && pnpm test`. **Done when:** AC 28.

## Stage 8 — AgentEditor Evals tab
- **Files:** `AgentEditor/constants.ts` (add `evals`), `AgentEditor.tsx`, new `AgentEditor/_components/EvalsTab/`
  (EvalsTab, metric strip with FP breakdown, case row, run-confirm modal, helpers, styles, tests) ·
  `AgentEditor.test.tsx` (replace the "no Evals tab" assertion) · `client/messages/en/eval.json`.
- **Done when:** ACs 29, 32.

## Stage 9 — Eval Dashboard, compare UI, sidebar
- **Files:** `client/src/app/eval/page.tsx` · `client/src/app/eval/_components/{EvalDashboardView,EvalRunsTable,RunCompareModal}/` ·
  `RunCompareModal/helpers.ts` (`diffTokens`, word LCS, 4 000-word cap) · `client/src/vendor/ui/nav.ts` + `nav.test.ts`
  (Eval Dashboard, `Gauge`, `/eval`) · `client/messages/en/eval.json`.
- **Checks:** client typecheck + test; `pnpm build` once (INSIGHTS: value imports from vendor/shared).
- **Done when:** ACs 26, 31, 32.

## Stage 10 — `verify:l06`
- **Files:** `server/package.json` (one script line: `"verify:l06": "node ../scripts/verify-l06.mjs"` —
  **APPROVAL REQUIRED**, no dependency, lockfile untouched) · `scripts/verify-l06.mjs`. **No root `package.json`.**
- **Steps (sequential, stop on first failure):** server typecheck → server eval unit tests → client typecheck → client
  tests → contract parity (L06 block of both `eval-ci.ts` copies byte-identical) → `--it`: `evals.it.test.ts` (Docker)
  → `--live --agent <id>`: read-only GETs on `:3001` (≥ 8 labeled cases, both kinds; ≥ 2 `done` runs with different
  `prompt_sha`; compare returns 200). No POST, no LLM.
- **Done when:** AC 33; `--live` gives AC 34 at demo time.

## Stage 11 — Review and verification
- architecture-reviewer + security-reviewer (workspace scoping, untrusted diff, paid-call limits) → fixes →
  plan-verifier (AC matrix). doc-writer: `server/docs/modules.md` eval section.

## Stage 12 — Demo (real data; every paid step approved separately)
- D1. Dataset per spec §17.2: in the UI, decide **every** distinct Test Reviewer finding location on PRs #3, #4, #5, #1
  honestly (Accept / Reject); then **Turn into eval case** on each → ≈ 11 eligible cases (≥ 8, both kinds). No DB writes
  by hand; if honest decisions give < 8 cases or one kind is missing → propose new real reviews (paid, approval).
- D2. `verify:l06 --live` → dataset check green.
- D3. **Paid:** run evals on the current prompt.
- D4. Edit the Test Reviewer system prompt (version bump). The prompt change is chosen and written down **before** the
  run; both a deliberately degraded variant ("report every possible issue, at least 10 findings") and an improved one
  are valid experiments — the result is reported as measured. **Paid:** run evals again.
- D5. Eval Dashboard → select both runs → Compare: deltas, FP breakdown, prompt diff, case flips.
- D6. `verify:l06 --live` → green; screenshots.

## AC coverage

| AC | Stage |
|---|---|
| 01-08 | 3 |
| 09-13, 21-22 | 5 |
| 14-20, 35 | 4 |
| 23, 25, 27 | 6 |
| 26, 31 | 9 |
| 28 | 7 |
| 29 | 8 |
| 30 | 2-6 (integration) |
| 32 | 8-9 |
| 33 | 10 |
| 34 | 12 |
| 36 | 1 (SQL review) + 3 (integration) |
| ~~24~~ | removed |
