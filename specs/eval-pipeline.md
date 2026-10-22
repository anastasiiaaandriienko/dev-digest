# Spec: L06 — Eval Pipeline (agent regression harness)

- **Key:** EVAL · **Status:** Approved (2026-10-22; synced with the implementation 2026-10-23) · **Date:** 2026-10-22 · **Packages:** server | client | contracts (reviewer-core: read-only reuse)
- **Source request:** course homework L06 "Eval Pipeline for DevDigest" (user, 2026-10-22).
- **Design reference:** `C:\Users\User\Downloads\DevDigest Design (standalone) (1).html` (unpacked and read:
  `findings.jsx`, `screen_agents.jsx`, `screen_skills.jsx` → `ScreenEval`/`RunCompare`, `screen_cizruns.jsx` →
  `EvalCaseEditor`, `components2.jsx` → `EvalCaseRow`, `chrome.jsx` → `NAV`, `data.jsx`/`data2.jsx` → `EVAL`, `EVAL_CASES`).

---

## 1. Problem statement and goals

Reviewers accept or dismiss findings, but those decisions are lost as a signal: nothing tells the author of an
agent whether a system-prompt change made the agent better or worse. L06 turns human decisions into a
**gold set** and gives every agent a repeatable, mechanical regression harness.

Goals:

- G1. Turn an **accepted** finding into a `must_find` eval case and a **dismissed** finding into a `must_not_flag`
  eval case, freezing the diff, PR metadata, expected file and line range at creation time.
- G2. `POST /agents/:id/eval-runs` runs one agent version over all its eval cases on the frozen inputs.
- G3. Score each run with **recall, precision, citation_accuracy** using a deterministic, LLM-free scorer.
- G4. Show metrics, case list and run history in **AgentEditor → Evals** and on an **Eval Dashboard** reachable from the sidebar.
- G5. Compare two runs of the same agent (typically two system-prompt versions): metric deltas, prompt diff, per-case flips.
- G6. `pnpm verify:l06` (run in `server/`, §17.1) validates the feature (tests + contract parity, optional live check of the demo data).
- G7. Final demo on **≥ 8 real cases** (from real accepted/dismissed findings) and ≥ 2 **real** runs with different prompts.

## 2. Current architecture and reusable components (verified)

| Area | Verified state | Evidence |
|---|---|---|
| `eval_cases` table | exists; `workspace_id`, `owner_kind ('skill'|'agent')`, `owner_id` (no FK), `name`, `input_diff`, `input_files`, `input_meta`, `expected_output` (jsonb), `notes`. No kind/label, no source finding, no `created_at`. | `server/src/db/schema/eval.ts:7-20` |
| `eval_runs` table | exists; per-case row: `case_id` FK cascade, `ran_at`, `actual_output`, `pass`, `recall`, `precision`, `citation_accuracy`, `duration_ms`, `cost_usd`. No workspace, agent, agent version or run-group id. | `eval.ts:22-35` |
| Migrations | 0000–0014; only `0000_init.sql` creates eval tables. | `server/src/db/migrations/meta/_journal.json:103-108` |
| Eval contracts | `EvalPerTrace`, `EvalRun` (metrics are non-null `0..1`), `EvalOwnerKind`, `EvalCase` (`expected_output: unknown`); `EvalCaseInput`, `EvalRunRecord`, `EvalRunResult`, `EvalTrendPoint`, `EvalDashboard`. No compare contract. No metric formulas defined anywhere. | `server/src/vendor/shared/contracts/knowledge.ts:49-84`, `eval-ci.ts:19-88` (client copy identical for these lines; the files differ elsewhere) |
| Finding decisions | `POST /findings/:id/accept|dismiss`; stored as mutually exclusive `findings.accepted_at` / `dismissed_at`; workspace checked via finding → review → pull. | `server/src/modules/reviews/routes.ts:171-178`, `findings.ts:11-34`, `repository/review.repo.ts:109-149` |
| Finding contract | `file`, `start_line`, `end_line`, `severity` (`CRITICAL|WARNING|SUGGESTION`), `category` (`bug|security|perf|style|test`), `kind`, `title`, … A "citation" is `file` + line range; no `rule_id`. | `contracts/findings.ts:47-62` |
| Review engine | `reviewPullRequest(ReviewInput)` needs only `systemPrompt`, `model`, parsed `UnifiedDiff`, injected `llm`; returns grounded `review`, `dropped[]`, tokens, `costUsd`. No I/O. | `reviewer-core/src/review/run.ts:45-131` |
| Grounding gate | kept iff file in diff and `[start,end]` intersects new-side hunk lines; full-file kinds only need the file. Exact string path match. | `reviewer-core/src/grounding.ts:24-84` |
| Diff parsing | `parseUnifiedDiff(raw)`; `loadDiff` (git diff, fallback to `pr_files` patches). | `server/src/adapters/git/diff-parser.ts:14`, `server/src/modules/reviews/diff-loader.ts:12-44` |
| Agent versions | `agents.version` + `agent_versions(agent_id, version, config_json)`; bump on config change; snapshot keys `provider, model, system_prompt, output_schema, strategy, ci_fail_on, repo_intel, skills(ids)`. `GET /agents/:id/versions[/:version]`. | `server/src/modules/agents/repository.ts:127-229`, `routes.ts:129-137` |
| LLM in tests | `MockLLMProvider` injected through `buildApp({ overrides })`; id typed `'openai'|'anthropic'`. | `server/src/adapters/mocks.ts:44-111`, `server/test/finding-decisions.it.test.ts:42-52` |
| Background work | reviews return 200 and continue with `void executor…`; `container.jobs` retries (unsafe for paid calls); boot reaper pattern exists. | `server/src/modules/reviews/service.ts:105-140`, `server/INSIGHTS.md` ("container.jobs retries every job") |
| FindingCard | `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:26-128`; Accept/"Reject" buttons; `useFindingAction` (`client/src/lib/hooks/reviews.ts:250-282`). | — |
| AgentEditor | tabs `config|skills|context` (`AgentEditor/constants.ts:11-18`, comment "Evals / Stats / CI come in later lessons"); `?tab=` routing in `AgentEditorView.tsx:37-42`; i18n `agents.json` already has `editor.tabs.evals`. | — |
| Skills EvalsTab | placeholder only (`EmptyState` "unavailable"), no data. | `client/src/app/skills/[id]/_components/SkillDetailView/_components/EvalsTab/EvalsTab.tsx:11-24` |
| Sidebar | `client/src/vendor/ui/nav.ts:21-39` — no eval item; `components/app-shell/helpers.ts:35` already maps `/eval*` → key `eval`. | — |
| UI kit | `MetricCard`, `LineChart`, `Sparkline`, `Modal`, `Tabs`, `Badge`, `Button`, `IconBtn`, `Checkbox`, `EmptyState`, `ErrorState`, `Skeleton`, icons `FlaskConical`, `Gauge`. No table component. | `client/src/vendor/ui/index.ts`, `charts/MetricCard.tsx:6-20` |
| i18n | `client/messages/en/eval.json` (84 lines) already holds dashboard / evalsTab / caseEditor strings; unused. | — |
| `verify:l06` | **does not exist** anywhere; no L06 lab instructions in the repo (`README.md:89` only lists "L06 · Eval pipeline …"). No root `package.json`; each package has its own (`server`, `client`: pnpm; `reviewer-core`, `e2e`, `devdigest-mcp`: npm). `server/package.json` equals HEAD and is **not** skip-worktree (`git ls-files -v` → `H`) — the skip-worktree note in `AGENTS.md`/`TESTING.md:89` is outdated. | repo-wide grep, `git ls-files -v` |
| Migration snapshot | `meta/0014_snapshot.json` has 43 tables = 43 `pgTable` definitions; its `eval_cases` / `eval_runs` columns, FKs and (no) indexes match `eval.ts` exactly. | read 2026-10-22 |
| Real data (read-only SELECT, 2026-10-22) | 34 findings, **0 accepted, 0 dismissed**, 0 eval cases/runs (tables exist, empty). Test Reviewer: 16 findings on PR #1 (1), #3 (9, from 3 reviews that repeat the same locations: `agents/routes.ts:35`, `:109`, `knowledge.ts:182`), #4 (3), #5 (3); one finding spans `routes.ts:24-109` (86 lines). Test Reviewer has 3 skills and a 115-char prompt. Other agents: Test Quality 7, API Contract 6, General 3; seed PR #482 2 (no agent, no patches). 3 seeded agents have no `agent_versions` row. All agents: `openrouter` / `deepseek/deepseek-v4-flash`. | local Postgres |

**Course metric semantics:** no course contract defines TP/FP/FN formulas. The only normative source is the design
copy in `screen_agents.jsx` (`EvalsTab`): *"Scoring is mechanical — a finding counts when file matches and line
ranges overlap. No model call in the scorer."* and the case results *"expected 1 finding, got 1"* / *"expected 0
findings, got 1"*. The rules in §8 implement that sentence and fill in the rest; the rest is this spec's decision.

## 3. Scope and non-goals

In scope: agent-owned eval cases created from decided findings; eval case list; eval runs (async) of the agent's
**current** version with config snapshots; deterministic scoring; history; compare; AgentEditor Evals tab; Eval
Dashboard page (agent picker + agent view) + sidebar entry; `verify:l06`; demo runbook.

Non-goals (v1, kept out to avoid unneeded complexity): skill evals (`owner_kind='skill'`; the Skills EvalsTab stays a
placeholder); hand-written cases and the full N3 Eval Case Editor (Files/PR-meta editing, "Finding skeleton", "Run on
save", single-case "Run case"); deleting/archiving cases; running an **older** agent version (compare = edit prompt →
run again); the cross-agent overview landing and "Recent eval runs · all agents" feed; "Promote vN"; "Run all agents";
"30 days" filter; CI export; LLM-based scoring or judging; run cancellation; editing the frozen input of a case.

## 4. User stories

- US1. As a reviewer, after accepting a finding I click **Turn into eval case** so the agent must keep finding it.
- US2. As a reviewer, after dismissing a finding I click **Turn into eval case** so the agent must not flag it again.
- US3. As an agent author, in **Agents → <agent> → Evals** I see the cases, the latest metrics and **Run all evals**.
- US4. As an agent author, after editing the system prompt I run evals again and see whether recall/precision moved.
- US5. As an agent author, on the **Eval Dashboard** I select two runs and **Compare** them: metric deltas, prompt diff, which cases flipped.
- US6. As the course grader, I run `pnpm verify:l06` and see a pass/fail summary.

## 5. Data model

All changes need **one new migration (`0015_*`), generated with `pnpm db:generate` only after approval and applied
only by the user** (AGENTS.md "Do not touch").

**Backward-compatibility contract (verified against `0000_init.sql` and `meta/0014_snapshot.json`):**
- The migration is **purely additive**: only `CREATE TABLE`, `ALTER TABLE … ADD COLUMN`, `ADD CONSTRAINT … FOREIGN KEY`,
  `CREATE [UNIQUE] INDEX`. It contains **no** `DROP`, `RENAME`, `ALTER COLUMN … TYPE / SET NOT NULL / SET DEFAULT`,
  `UPDATE`, `DELETE` or `TRUNCATE`. The generated SQL is rejected and regenerated if it contains anything else.
- Every column added to the existing `eval_cases` / `eval_runs` is **NULLable with no DEFAULT**, so PostgreSQL writes
  nothing into existing rows (an `ADD COLUMN … DEFAULT now()` would backfill them — not allowed). New rows get the
  values from the application.
- Existing columns, FKs (`eval_cases.workspace_id`, `eval_runs.case_id` cascade) and semantics stay unchanged.
- Rows that predate L06 (`kind IS NULL`, any `owner_kind='skill'` row) are **legacy**: the agent pipeline never reads,
  scores, updates or deletes them. Today both tables are empty (0 rows), so nothing is at risk, but the rules hold for
  any other database.
- The new unique index is partial (`WHERE source_finding_id IS NOT NULL`), so legacy rows can never violate it.
- Rollback: drop the new table and the new columns; old code ignores them.

### 5.1 `eval_cases` — add columns (all NULLable, no default)

| Column (SQL) | TS | Type | Notes |
|---|---|---|---|
| `kind` | `kind` | text (`must_find|must_not_flag`, Drizzle text enum — no PG enum/CHECK) | the label; required by the app for new rows |
| `source_finding_id` | `sourceFindingId` | uuid, FK `findings.id` ON DELETE SET NULL | provenance (findings are never deleted today; SET NULL is defensive) |
| `input_hash` | `inputHash` | text | sha256 of the frozen input (§10); groups cases for one engine call |
| `created_at` | `createdAt` | timestamptz | set by the app on insert |

Index: unique `(owner_kind, owner_id, source_finding_id) WHERE source_finding_id IS NOT NULL` (one case per finding
per owner); index `(workspace_id, owner_kind, owner_id)`. Cases are not deleted in v1, so `eval_runs.case_id … ON DELETE
CASCADE` can never erase history.

Existing columns, frozen at creation:
- `input_diff` — raw unified diff text of the PR (§7.3).
- `input_files` — `null` in v1 (the engine consumes only the diff; listing the changed paths is derivable from the diff).
- `input_meta` — `EvalCaseMeta` JSON (§6.1): PR number/title/body, repo full name, base, head_sha, source review/agent/agent_version, finding title/severity/category/decision timestamp.
- `expected_output` — `EvalExpectation` JSON (§6.1): `{ kind, file, start_line, end_line, severity, category, title }`.

### 5.2 New table `agent_eval_runs` (one row per `POST /agents/:id/eval-runs`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `workspace_id` | uuid NOT NULL FK workspaces cascade | scoping |
| `agent_id` | uuid NOT NULL FK agents cascade | |
| `agent_version` | integer NOT NULL | version that was run |
| `config_snapshot` | jsonb NOT NULL | `EvalConfigSnapshot` (§11) — incl. full system prompt |
| `prompt_sha` | text NOT NULL | sha256 of `system_prompt` (cheap "different prompt" check) |
| `status` | text enum `running|done|failed` NOT NULL | |
| `error` | text NULL | |
| `started_at` / `finished_at` | timestamptz | |
| `recall`, `precision`, `citation_accuracy` | double NULL | null = undefined (zero denominator) or run not done |
| `counts` | jsonb NULL | `EvalCounts` (§8): cases_total/passed, tp, fp by reason, fn, kept, raw, valid citations, tokens |
| `duration_ms` | integer NULL | |
| `cost_usd` | double NULL | null if any engine call's cost is unknown (engine rule) |

Index `agent_eval_runs_ws_agent_idx (workspace_id, agent_id, started_at)`; UNIQUE partial index
`agent_eval_runs_one_running_uq (agent_id) WHERE status = 'running'` — at most one running run per agent at the DB level.

### 5.3 `eval_runs` — reuse as the per-case result, add columns

| Column | Type | Notes |
|---|---|---|
| `suite_run_id` | uuid NULL, FK `agent_eval_runs.id` ON DELETE CASCADE, no default | NULL only for legacy rows (none exist) |
| `outcome` | text NULL (`tp|fn|pass|fail|error`), no default | case verdict (must_find: `tp`/`fn`; must_not_flag: `pass`/`fail`) |

`actual_output` stores `StoredCaseOutput` (`server/src/modules/evals/runner.ts`): `{ input_hash, result: EvalCaseResult,
engine: { status, error, kept, dropped, tokens, cost, duration } }` — everything needed to re-score the run offline
(§10). `pass`, `outcome`, `duration_ms` and `cost_usd` (group values split equally across the group's cases) are
filled; the legacy per-case `recall`/`precision`/`citation_accuracy` columns stay NULL (metrics are run-level). Index `(suite_run_id)`.

Row types `EvalCaseRow`, `EvalRunRow`, `AgentEvalRunRow` go to `server/src/db/rows.ts`.

## 6. API contracts

### 6.1 New Zod contracts — additive, appended to `contracts/eval-ci.ts` in **both** vendored copies

```ts
EvalCaseKind = z.enum(['must_find', 'must_not_flag'])
EvalExpectation = { kind: EvalCaseKind, file, start_line: int>=1, end_line: int>=start_line,
                    severity: Severity, category: Category, title }
EvalCaseMeta = { pr_number, pr_title, pr_body: string|null, repo: string, base, head_sha,
                 source_review_id, source_agent_id, source_agent_version: int|null,
                 decided_at: string, diff_stats: { files, additions, deletions } }
AgentEvalCase = { id, agent_id, name, kind, expected: EvalExpectation, meta: EvalCaseMeta,
                  input_hash, created_at, notes,
                  source_finding_id: string|null,
                  last_result: { suite_run_id, outcome, ran_at } | null }
CreateEvalCaseFromFinding = { name?: string(1..80, /^[a-z0-9][a-z0-9-]*$/), notes?: string(<=500) }  // strict
StartEvalRunInput = {}                                     // strict; always runs the agent's current version
EvalConfigSnapshot = { provider, model, strategy, system_prompt, agent_version,
                       skills: { id, name, version, body }[],          // bodies frozen, see §11
                       excluded: ('repo_intel'|'intent'|'project_context'|'memory'|'conventions')[] }
EvalFpReason = z.enum(['too_wide', 'duplicate', 'negative_hit', 'unlabeled'])
EvalCounts = { cases_total, cases_passed, tp, fn, fp, fp_by_reason: Record<FpReason, int>,
               kept, raw, valid_citations, tokens_in, tokens_out }
AgentEvalRun = { id, agent_id, agent_version, prompt_sha, status: 'running'|'done'|'failed', error: string|null,
                 started_at, finished_at: string|null,
                 recall: number|null, precision: number|null, citation_accuracy: number|null,
                 counts: EvalCounts|null, cost_usd: number|null, duration_ms: number|null }
EvalCaseResult = { case_id, case_name, kind, outcome, pass, expected: EvalExpectation,
                   matched_finding: Finding|null, overlapping: Finding[],   // kept findings touching this location
                   group_fp: { finding: Finding, reason: FpReason }[],      // FPs of the case's input group
                   dropped: { finding: Finding, reason: string }[] }
EvalCaseRunResult = EvalCaseResult & { error: string|null }       // engine error of the case's group
AgentEvalRunDetail = AgentEvalRun & { config: EvalConfigSnapshot|null, results: EvalCaseRunResult[] }
EvalConfigSummary = { provider, model, strategy, agent_version, prompt_sha,
                      skills: { id, name, version, body_sha }[] }   // no prompt text, no skill bodies
EvalSkillChange = { id, name, change: 'added'|'removed'|'changed', base_version: int|null, head_version: int|null }
EvalRunComparison = { base: AgentEvalRun, head: AgentEvalRun,
                      base_prompt: string, head_prompt: string,
                      config: { base: EvalConfigSummary|null, head: EvalConfigSummary|null },
                      skill_changes: EvalSkillChange[],
                      delta: { recall, precision, citation_accuracy, cost_usd },  // number|null each
                      prompt_changed: boolean, config_changes: ('model'|'provider'|'strategy'|'skills')[],
                      same_case_set: boolean,
                      cases: { case_id, case_name, kind, base: outcome|null, head: outcome|null,
                               change: 'fixed'|'regressed'|'unchanged'|'only_base'|'only_head' }[] }
```

`FindingRecord` (`contracts/review-api.ts`, both copies) gains `eval_case_id: z.string().nullish()` (absent or null =
no case; optional for backward compatibility; the server always sends it, null when none) so the card knows a finding is already in the eval set.

The existing `EvalCase`, `EvalRun`, `EvalRunRecord`, `EvalDashboard`, `EvalTrendPoint` stay unchanged (not deleted;
no current consumer). They are not reused because their metrics are non-nullable and they model per-case rows, not
run groups — reusing them would force fake `0`/`1` values for undefined metrics.

### 6.2 Endpoints (new module `server/src/modules/evals/`, registered in `modules/index.ts`)

| Method + path | Body / query | Success | Errors |
|---|---|---|---|
| `POST /findings/:id/eval-case` | `CreateEvalCaseFromFinding` | 201 `AgentEvalCase` | 404 not found / other workspace; 409 `finding_not_decided`; 409 `eval_case_exists` (existing id in `error.details.eval_case_id`); 409 `duplicate_location`; 409 `conflicting_label`; 422 `finding_has_no_agent`; 422 `location_not_in_diff`; 422 `range_too_wide`; 422 `diff_unavailable`; 413 `diff_too_large` |
| `GET /agents/:id/eval-cases` | — | 200 `AgentEvalCase[]` (labeled cases only, newest first) | 404 |
| `POST /agents/:id/eval-runs` | `StartEvalRunInput` | **202** `AgentEvalRun` (`status: running`) | 404; 409 `eval_run_in_progress`; 422 `no_eval_cases`; 422 `too_many_cases`; 500 `config_error` (missing API key, nothing written) |
| `GET /agents/:id/eval-runs` | `?limit=1..100` (default 30) | 200 `AgentEvalRun[]` newest first | 404 |
| `GET /eval-runs/:id` | — | 200 `AgentEvalRunDetail` | 404 |
| `GET /eval-runs/compare` | `?base=<uuid>&head=<uuid>` | 200 `EvalRunComparison` | 404; 422 `different_agents`; 409 `run_not_done` |

Six endpoints in total. The Eval Dashboard lists agents with the existing `GET /agents` and reads history with
`GET /agents/:id/eval-runs` — no separate overview endpoint.

Route-level rate limit for `POST /agents/:id/eval-runs` and `POST /findings/:id/eval-case`: `{ max: 10, timeWindow: '1 minute' }`
(same as `POST /pulls/:id/review`, `reviews/routes.ts:34`). Params use `IdParams` (uuid → 422). Inputs are `.strict()`.

## 7. Eval case creation from findings

7.1 **Label is derived on the server** from the current decision: `accepted_at` set → `must_find`; `dismissed_at` set →
`must_not_flag`; neither → 409 `finding_not_decided`. The client never sends the label.

7.2 **Owner:** `owner_kind='agent'`, `owner_id = reviews.agent_id` of the finding's review. Null agent → 422.

7.3 **Frozen diff:** the same diff the agent reviewed. v1 source: `loadDiff(...)` for the finding's PR
(`diff-loader.ts:12`), stored as `diff.raw`. If the result has no files → 422 `diff_unavailable`. Limit
`EVAL_MAX_DIFF_CHARS = 400_000` → 413. *Assumption A1: the PR's head has not moved since the review; if
`pull.head_sha` differs from the review run's head the case still uses the current diff and `meta.head_sha` records it.*

7.4 **Expected location:** finding `file`, `start_line`, `end_line` (normalized §8.1). The location must intersect
the frozen diff (same rule as the grounding gate) → else 422 `location_not_in_diff` (a case the agent can't satisfy
is rejected).

7.5 **One location = one case.** Within the same agent and `input_hash` (checked in the insert transaction):
- same finding twice → 409 `eval_case_exists`;
- a location overlapping an existing case of the **same** kind → 409 `duplicate_location` (real data: PR #3 has three
  Test Reviewer reviews that repeat `routes.ts:35`, `:109`, `knowledge.ts:182`; without this rule one issue would be
  counted 2-3 times and one correct finding could never satisfy all copies — max matching gives TP 1, FN 2);
- a location overlapping a case of the **opposite** kind → 409 `conflicting_label`.

7.5a **Range width.** An expected range wider than `EVAL_MAX_SPAN_LINES = 50` lines → 422 `range_too_wide` (a wide
expectation would be matched by almost any finding in the file and inflate recall; real data: `routes.ts:24-109`).

7.6 **Name:** default `must-find-<slug(title)>` / `no-<slug(title)>` (design `findingToSeed`), ≤ 80 chars, de-duplicated per
agent with `-2`, `-3`…; user may override in the modal.

7.7 A later change of the finding's decision does **not** modify an existing case (cases are snapshots); the card
shows "In eval set".

## 8. Deterministic scoring (pure function, no LLM, no I/O)

Location: `server/src/modules/evals/scoring.ts`. Signature:
`scoreSuite(groups: { diff: UnifiedDiff; cases: ScoredCase[]; status: 'ok' | 'failed'; kept: Finding[];
dropped: { finding: Finding; reason: string }[] }[]): SuiteScore`.
Same input → byte-identical output (stable sort everywhere, no `Date`, no randomness).

### 8.1 Normalization

- **Path:** `trim` → `\` to `/` → strip leading `./` (repeatedly) and leading `/` → collapse `//`. Case-sensitive.
  `a/`, `b/` prefixes are **not** stripped (they would corrupt real directories; the diff parser already strips them).
- **Range:** `lo = min(start,end)`, `hi = max(start,end)`. A finding with non-integer lines or `lo < 1` is
  **invalid**: it can never match, and counts as an invalid citation.
- **Overlap(f, loc):** `path(f.file) === path(loc.file) && f.lo <= loc.hi && loc.lo <= f.hi` (inclusive, 0 lines of tolerance).
  Severity, category and title are **not** part of the match (design: "file matches and line ranges overlap");
  they are reported as `severity_match` / `category_match` info only.

### 8.2 What is scored

Per input group *g* (cases sharing `input_hash`, §9) the engine returns `kept` (passed grounding) and `dropped`.
`raw = kept ∪ dropped`. **Precision/recall use `kept`** (what a user would see); **citation_accuracy uses `raw`**
(so hallucinated locations are penalised instead of silently disappearing).

### 8.3 Matching and TP / FN (one finding counts at most once)

- `P_g` = must_find expectations in *g*, `N_g` = must_not_flag locations in *g*.
- A kept finding whose span `hi − lo + 1 > EVAL_MAX_SPAN_LINES (50)` is **not matchable** (a whole-file range must not
  be able to "find" any expectation in the file).
- Build a bipartite graph `P_g × matchable(kept_g)` with an edge where `Overlap` holds. Compute a **maximum matching**
  with Kuhn's augmenting-path algorithm, visiting expectations sorted by `(file, lo, hi, case_id)` and candidate
  findings sorted by `(overlap length desc, |f.lo − e.lo| asc, file, lo, hi, original index)`. Each expectation is
  matched to at most one finding and each finding to at most one expectation.
- **TP** = number of matched expectations. **FN** = `|P_g| − TP_g`.

### 8.4 FP — closed world over the frozen input (decision D1)

**Every kept finding that is not matched is a false positive.** `FP_g = |kept_g| − TP_g`. Each FP is tagged with
exactly one reason, first match wins:
1. `too_wide` — span > 50 lines;
2. `duplicate` — overlaps a must_find location that is already matched;
3. `negative_hit` — overlaps a must_not_flag location in *g* (one FP **per finding**, even if it overlaps several
   negatives; two findings on one negative = 2 FP);
4. `unlabeled` — touches no labeled location of *g*.

(After a maximum matching, a matchable unmatched finding cannot overlap an *unmatched* expectation — otherwise the
matching could be augmented; so "missed" findings never hide among the unlabeled ones.) A matched finding that also overlaps a must_not_flag
location stays TP and is never double-counted; creation rule 7.5 prevents such labels from coexisting.

**Why closed world.** The earlier draft ("unlabeled is not FP") lets precision **rise** while the agent gets worse.
Example, gold set 6 must_find + 3 must_not_flag:

| Run | kept | TP | negative_hit | unlabeled | open-world P = TP/(TP+neg) | closed-world P = TP/kept | recall |
|---|---|---|---|---|---|---|---|
| v1 (focused prompt) | 7 | 5 | 1 | 1 | 0.83 | **0.71** | 0.83 |
| v2 ("report every possible issue") | 20 | 6 | 1 | 13 | **0.86 ↑** | **0.30 ↓** | 1.00 |

Open-world rewards spam (recall and precision both "improve"); closed-world shows the real cost (13 unverified
comments). Closed-world is the conservative choice: it is a **lower bound** of the true precision, because an
unlabeled finding may still be correct. It is chosen **before** any run and is not tuned to a result. Two rules keep
the bound fair: (a) the labeling protocol (§17, D1) decides **every** distinct finding location of each review used,
so every location the agent flagged at labeling time is labeled; (b) the run detail lists `unlabeled` findings with
file:line so a human can see what was counted, and the FP breakdown `fp_by_reason` is always shown next to precision.

### 8.5 Case verdicts

- must_find: `tp` (pass) if its expectation is matched, else `fn` (fail). Result text: "expected 1 finding, got N" where N = kept findings overlapping it.
- must_not_flag: `pass` iff **no** kept finding overlaps its location, else `fail`. Result text: "expected 0 findings, got N".
- Engine failure for the group → every case of the group `error` (fail); see 8.7.

### 8.6 Aggregates (micro-averaged over the whole run)

- `TP, FN, FP, fp_by_reason, kept, raw, valid_citations` = sums over groups.
- **recall** = `TP / (TP + FN)`; **null** if the run has no must_find case.
- **precision** = `TP / (TP + FP)` = `TP / kept`; **null** if `kept = 0` (nothing to judge). Never defaults to 1.
- **citation_accuracy** = `valid_citations / raw`, where a raw finding has a valid citation iff it is not invalid
  (8.1) **and** `groundFindings([f], diff_g).kept.length === 1` (exactly the engine's citation gate,
  `reviewer-core/src/grounding.ts:52`, including the full-file exemption); **null** if `raw = 0`. It measures
  *whether the agent cites real changed lines*, independent of whether the finding is correct.
- `cases_passed / cases_total` = case verdicts.
- Values are stored unrounded; UI rounds to whole percent.

Anti-gaming properties (each is a unit test): duplicates never raise TP and lower precision; a dismissed location
flagged again lowers precision and fails its case; extra unlabeled comments lower precision; a whole-file range
cannot earn a TP; emitting nothing gives recall 0 (if must_find cases exist) and precision null — never 100 %;
hallucinated locations lower citation_accuracy; deleting negatives is impossible from the run (cases are fixed for
the run and counted in `cases_total`).

### 8.7 Failed runs

If any group's engine call fails after the engine's own retries, the run ends `status='failed'` with `error`;
per-case rows of finished groups are kept, **run-level metrics are null** and the run is excluded from trends and
cannot be compared (no partial metrics that would look better than reality).

## 9. Eval runner architecture

- `EvalService.startRun(workspaceId, agentId, input)`: load agent (scoped), resolve config snapshot (§11), load
  labeled cases (`owner_kind='agent'`, `owner_id`, `kind IS NOT NULL`; ≥ 1 else 422; ≤ `EVAL_MAX_CASES = 50` else 422),
  build the provider (missing key → `ConfigError`, nothing written), fail this agent's runs stuck in `running` for more
  than `EVAL_STALE_RUN_MINUTES`, check no `running` run for the agent (409; a concurrent start is caught by the unique
  partial index `agent_eval_runs_one_running_uq` → 409), insert `agent_eval_runs(status='running')`, return 202, then
  `void this.runner.execute(job).catch(markFailed)` — **not** `container.jobs` (it retries paid calls).
- `EvalRunner.execute`: group cases by `input_hash` (≤ `EVAL_MAX_INPUT_GROUPS = 20`), and **sequentially** per group:
  `parseUnifiedDiff(case.input_diff)` → `reviewPullRequest({ systemPrompt, model, strategy, diff, llm:
  await container.llm(provider), skills, prDescription: meta.pr_body, task: taskLine({ number, title, author: 'the PR author' }),
  sessionId: `eval:<runId>:<n>` })`. The first failed group stops the run: later groups are not called (no further paid
  calls) and become `error`. A group whose answer has more than `EVAL_MAX_FINDINGS_PER_GROUP = 200` findings (kept +
  dropped) fails instead of being truncated (truncation would hide FPs). Then the scorer (§8) runs once over all groups,
  and ONE guarded transaction writes the per-case rows and the run row (`WHERE status='running'`; a reaped run is never
  overwritten and gets no rows). One engine call per distinct input (the cost of a run is "number
  of distinct PRs", not "number of cases"). Group cost/duration are split equally across its cases; the run row stores
  exact totals. Final update is guarded `WHERE status='running'`.
- **Not passed** to the engine (they are not frozen): repo-intel callers/map, intent, project context, memory,
  conventions. Recorded in the snapshot as `excluded: [...]`.
- Boot reaper: every `running` row → `failed` / `interrupted` (a run lives only in the process that started it; same
  pattern as `reapStaleRunningRuns`).
- Long runs are never "stale": the service keeps a module-level set of the runs executing in this process. A run in
  that set is excluded from the stale check, however long it takes, so a second start for its agent gets 409 — no
  parallel paid run. A `running` row older than `EVAL_STALE_RUN_MINUTES = 30` that no process here executes (its
  process died without a restart) is failed (`stale: the run lost its process`) by the next `startRun` of that agent.
- Before every engine (= paid) call the runner checks that its run is still `running`; a run failed from outside
  (reaper, another process) stops with `stopped: the run is no longer running` and makes no further call. Its guarded
  finalize then writes nothing.
- Layering: route → `EvalService` → `EvalRepository` (+ `eval-case.repo.ts`, `eval-run.repo.ts`), `EvalRunner` gets
  `container.llm` through the Container; reviewer-core is called only from the runner (onion rule).
- The client polls `GET /eval-runs/:id` every 2 s while `running` (no SSE in v1).

## 10. Fixed-input reproducibility

- Input = `input_diff` + `meta.pr_title` + `meta.pr_body`, frozen at creation, never edited.
  `input_hash = sha256(input_diff + '\0' + pr_title + '\0' + (pr_body ?? ''))`.
- Every run stores its full `config_snapshot` and every per-case `actual_output`, so any run can be **re-scored**
  offline from stored data with identical results (the scorer is a pure function; property test).
- LLM output itself is **not** deterministic (provider default temperature; `anthropic.ts:72` uses 0.2). The spec
  guarantees fixed inputs and deterministic scoring, not identical model output; repeated runs of one version may differ.

## 11. Agent prompt / version snapshots

- A run always uses the agent's **current** config: `provider, model, strategy, system_prompt` read from the `agents`
  row at run start, `agent_version = agents.version`. Reading the live row (not `agent_versions`) is deliberate: the 3
  seeded agents have no `agent_versions` row, and the snapshot is stored in the run anyway. To compare prompts the user
  edits the prompt (version bump, `agents/repository.ts:127-209`) and runs again.
- Skills: resolved at run start with the same code the review path uses (`agents.effectiveSkills` + `planSkills`,
  `run-executor.ts`) and frozen in the snapshot **with their bodies** (Test Reviewer has 3 skills, so excluding them
  would evaluate an agent that never ships). *Assumption A2 (Q2).* Compare lists `skills` in `config_changes` when the
  frozen skill set or bodies differ, so a prompt comparison is never confounded silently.
- `prompt_sha` lets the UI show "same prompt" and `verify:l06 --live` check "≥ 2 runs with different prompts".

## 12. UI requirements (English copy; existing DevDigest design system; `@devdigest/ui` components only)

12.1 **FindingCard** (PR Detail, FindingsPanel + DiffTab inline): in the actions row, after a decision, a ghost button
`FlaskConical` **Turn into eval case** with title *"Create a 'must find' eval case from this finding"* / *"Create a
'must NOT comment' eval case from this dismissal"* (design `findings.jsx` ActionRow). Opens **Add to eval set** modal:
kind banner (*Positive case* / *Negative case* + assertion "MUST find "<title>" at file:lines" / "MUST NOT comment on
file:lines (title)"), editable name, expected JSON (from the finding), buttons Cancel / Save. The frozen diff is not
shown in v1 (it is taken server-side).
After save the button becomes a disabled **In eval set** badge (from `eval_case_id`). Hidden for findings without
agent. Errors show inline (`ErrorState` text from the error code).

12.2 **AgentEditor → Evals** tab (`?tab=evals`, after Context): "Eval metrics" section with 4 tiles — Recall,
Precision, Citation accuracy, Cases passed — values of the latest **done** run and ▲/▼ pt delta vs the previous done
run (**N/A** for a null metric, and no delta); helper line *"Scoring is mechanical — a finding counts when file matches and line ranges overlap.
No model call in the scorer."*; link **View full dashboard →** (`/eval?agent=<id>`); "Eval cases" heading with badges
"x / y passing", "n cases"; **Run evals** (confirm modal *Run evals?*: *"Runs <agent> v<N> on <n> eval cases (<g> distinct
inputs)."* + a paid-LLM-call warning, button **Start eval run**; nothing starts on opening the tab; disabled with a
reason while a run is running or there are no cases; start errors stay in the dialog); a running banner while a run
is in progress and a warning banner when the newest run failed; **Recent runs** (5 newest: status running / done /
failed, start time, version, R / P / C, cost — N/A when unknown — and **Details →** to `/eval?agent=<id>&run=<runId>`,
the run view of the Eval Dashboard, §12.3); case rows (design
`EvalCaseRow`): status icon (pass/fail/never), mono name, kind pill *must find* / *must not flag*, last result text,
expected badge ("CRITICAL · security" / "assert empty"). No delete in v1. Under the precision tile a small line shows
the FP breakdown (*"FP: 2 unlabeled · 1 dismissed location · 0 duplicate"*). Empty state: *"No eval cases yet.
Accept or dismiss findings on a pull request and turn them into eval cases."*

12.3 **Eval Dashboard** `/eval` (sidebar SKILLS LAB → **Eval Dashboard**, icon `Gauge`, after Conventions), one page:
title *Eval Dashboard*, agent dropdown (from `GET /agents`; `?agent=<id>`, default = the first agent; empty state when
there are no agents, an error for an unknown agent id), **Open agent →** (Evals tab), **Run evals** (the same paid-call
confirmation as the Evals tab, shared component), running banner, warning banner when precision dropped vs the
previous done run, 3 `MetricCard`s (N/A for null) with trend sparklines, `LineChart` "Metric trend" (only finished runs
with all three metrics defined; a note says how many were left out, because the chart would draw a null as 0), **Recent runs** table (checkbox, Ran at, Version, Recall,
Precision, Citation, Pass, Cost, status for running/failed), hint *"Select two finished runs to compare"*, **Compare** enabled
only with exactly 2 done runs selected (third click replaces the oldest selection, as in the design; failed / running
runs have no checkbox). Clicking a run opens its detail (`?run=<runId>`, a drawer over `GET /eval-runs/:id`): status +
error, R / P / C (N/A), TP / FN / FP, FP reasons, the false positives (de-duplicated across a group), dropped count,
tokens / cost / duration, per-case results (matched / overlapping / engine error) and the config snapshot with the
system prompt. The design's cross-agent landing view is out of scope (§3).
12.4 **Compare modal** (design `RunCompare`): title *"Compare runs · vA → vB"* (older → newer), 4 metric tiles old → new with deltas, notice when `prompt_changed=false` (*"Both runs used the same system prompt"*), `config_changes` and `same_case_set=false` warnings, *System prompt diff* (word-level LCS diff, del/add colours; the common prefix / suffix is matched first and only the
differing middle is capped at 3 000 tokens per side, with a note that the diff shows only the first part), the config of both runs side by side
(provider, model, strategy, prompt sha, skills) with `skill_changes`, per-case table with change badges *fixed / regressed / unchanged / only in old / only in new*. No "Promote" button.
12.5 Loading → `Skeleton`; errors → `ErrorState`; all strings in `client/messages/en/eval.json` (+ `prReview.json` for the card).

## 13. Security and workspace isolation

- Every query is scoped by `workspaceId` from `getContext` (`_shared/context.ts:14`); `eval_runs` is reached only
  through `agent_eval_runs.workspace_id`, `eval_cases` through its own `workspace_id`; foreign ids from another workspace → **404** (no existence leak).
- Finding → case checks finding → review → pull workspace (reuse `findingContext`, `review.repo.ts:109`).
- Frozen diffs and PR bodies are untrusted: they reach the model only through the engine (`wrapUntrusted` + `INJECTION_GUARD`);
  UI renders them as text, never HTML/Markdown.
- No user-supplied diff in v1 (the server copies it), body size ≤ 1 MiB (`app.ts:50`), diff ≤ 400 000 chars.
- Paid calls: rate limit 10/min, one running run per agent, ≤ 50 cases / ≤ 20 groups per run.
- Frozen diffs may contain secrets already present in `pr_files`; no new exposure, but cases are workspace-private and never logged in full.

## 14. Error handling

| Failure | Behaviour | AC |
|---|---|---|
| Finding undecided | 409 `finding_not_decided`, UI button hidden | AC-EVAL-03 |
| Case already exists | 409 `eval_case_exists` + `eval_case_id`; UI shows "In eval set" | AC-EVAL-04 |
| Same location already a case / opposite label on same input | 409 `duplicate_location` / `conflicting_label` | AC-EVAL-05 |
| Finding without agent / location outside diff / range > 50 lines / diff unavailable / too large | 422 / 422 / 422 / 422 / 413 | AC-EVAL-06 |
| No cases / too many | 422 | AC-EVAL-10 |
| Run already running | 409 `eval_run_in_progress` | AC-EVAL-11 |
| Missing API key | `ConfigError` before the run row is created | AC-EVAL-12 |
| LLM error / timeout in a group | run `failed`, metrics null, finished groups kept | AC-EVAL-21 |
| Server restart mid-run | boot reaper → `failed: interrupted` | AC-EVAL-22 |
| Compare of different agents / unfinished run | 422 / 409 | AC-EVAL-27 |
| Other workspace | 404 | AC-EVAL-30 |

## 15. Testing strategy

- **Unit (server, no Docker)** `server/test/eval-scoring.test.ts`: every rule in §8 as a table test (overlap edges,
  path normalization, invalid lines, too-wide findings, duplicates, negative hits, unlabeled-as-FP, Kuhn vs greedy
  counter-example, zero denominators, failed groups, the §8.4 spam example (precision must fall), determinism:
  shuffled input → identical output, re-score from stored output). `eval-helpers.test.ts`: label derivation, name
  slug/dedup, `input_hash`, duplicate/conflict/width checks, compare. `eval-runner.test.ts`: grouping (one engine call
  per input) with `MockLLMProvider` + fake repos.
- **Integration (`server/test/evals.it.test.ts`, Docker — needs approval to run)**: create from accepted/dismissed,
  409/422 paths, workspace isolation, full run with `MockLLMProvider` (registered under `openrouter`; the mock's id
  type is widened — test-only change), history, compare, reaper; plus a migration test: legacy rows inserted with the
  0014 columns only are still present and unchanged after the run and are ignored by the pipeline.
- **Client (RTL)**: FindingCard button/modal states; Evals tab (metrics, nulls as "N/A", FP breakdown, cases, run
  confirm, running state); Eval Dashboard agent picker/history; compare selection rules; prompt diff helper; nav item. Existing tests
  that mock `useFindingAction` (DiffTab, FindingsPanel, ReviewRunAccordion, InlineFinding) and `AgentEditor.test.tsx`
  (asserts no Evals tab, `:73-80`) are updated.
- **e2e:** none in v1 (would need a hermetic seeded flow; optional follow-up, approval).
- **No test makes a real LLM call.** The final demo uses **real** runs (§17 D-steps), never mocks.

## 16. Acceptance criteria (EARS)

| AC-ID | Statement | Verification |
|---|---|---|
| AC-EVAL-01 | When a user creates an eval case from an accepted finding, the system shall store a `must_find` case owned by the finding's agent with the frozen diff, PR meta, file and normalized line range. | integration (approval) |
| AC-EVAL-02 | When a user creates an eval case from a dismissed finding, the system shall store a `must_not_flag` case with the same frozen fields. | integration (approval) |
| AC-EVAL-03 | If the finding is neither accepted nor dismissed, then the system shall reject with 409 `finding_not_decided`. | integration (approval) |
| AC-EVAL-04 | If a case already exists for the finding and agent, then the system shall reject with 409 `eval_case_exists` and return its id. | integration (approval) |
| AC-EVAL-05 | If a new case's location overlaps an existing case on the same agent and input, then the system shall reject with 409 `duplicate_location` (same kind) or `conflicting_label` (opposite kind). | integration (approval) |
| AC-EVAL-06 | If the finding has no agent, its location is outside the diff or wider than 50 lines, or the diff is unavailable/too large, then the system shall reject with 422/413 and the documented code. | integration (approval) |
| AC-EVAL-07 | The system shall derive the case label on the server and ignore any label sent by the client (strict body). | unit + integration |
| AC-EVAL-08 | When the decision of a finding changes after case creation, the system shall leave the case unchanged. | integration (approval) |
| AC-EVAL-09 | When `POST /agents/:id/eval-runs` is called, the system shall create a `running` run with a config snapshot and return 202. | integration (approval) |
| AC-EVAL-10 | If the agent has no labeled cases or more than 50, then the system shall reject with 422. | integration (approval) |
| AC-EVAL-11 | While a run of the agent is `running`, the system shall reject a new run with 409. | integration (approval) |
| AC-EVAL-12 | If the provider key is missing, then the system shall fail before inserting a run row. | integration (approval) |
| AC-EVAL-13 | The runner shall call the engine once per distinct `input_hash` and only with the frozen diff, PR title/body, snapshot prompt/model/strategy and frozen skills (no repo-intel, intent, context, memory). | unit |
| AC-EVAL-14 | The scorer shall match a finding to an expectation only on equal normalized path and inclusive line-range overlap. | unit |
| AC-EVAL-15 | The scorer shall count each expectation and each finding at most once (maximum matching). | unit |
| AC-EVAL-16 | The scorer shall count extra findings on an already matched must_find location as FP `duplicate`. | unit |
| AC-EVAL-17 | The scorer shall count each kept finding overlapping a must_not_flag location as one FP and fail that case. | unit |
| AC-EVAL-18 | The scorer shall count every kept finding that is not matched as FP (closed world) with exactly one reason `too_wide`, `duplicate`, `negative_hit` or `unlabeled`, so that `FP = kept − TP`. | unit |
| AC-EVAL-19 | The scorer shall compute recall, precision and citation_accuracy per §8.6 and return null for a zero denominator. | unit |
| AC-EVAL-20 | The scorer shall return identical output for identical input regardless of input order and shall make no LLM or I/O call. | unit |
| AC-EVAL-21 | If any engine call of a run fails, then the system shall mark the run `failed` with null metrics and keep finished case rows. | unit + integration (approval) |
| AC-EVAL-22 | When the server boots, the system shall mark every `running` eval run as `failed` (`interrupted`); when a run is started, the agent's runs running for more than 30 min that this process is not executing shall be marked `failed` first, while a run still executing here is never failed as stale (a second start gets 409), and a run that is no longer `running` shall make no further engine call. | integration (approval) |
| AC-EVAL-23 | `GET /agents/:id/eval-runs` shall list the agent's runs newest first with metrics, version, prompt_sha, cost and status. | integration (approval) |
| ~~AC-EVAL-24~~ | ~~Run an older `agent_version`~~ (removed — out of scope, §3) | — |
| AC-EVAL-25 | `GET /eval-runs/compare` shall return metric deltas, `prompt_changed`, `config_changes`, `same_case_set` and per-case changes. | integration (approval) |
| AC-EVAL-26 | The compare UI shall show the word-level system-prompt diff between the two runs. | unit (client) |
| AC-EVAL-27 | If the two runs belong to different agents or one is not `done`, then compare shall reject with 422 / 409. | integration (approval) |
| AC-EVAL-28 | Where a finding is decided and has an agent, the FindingCard shall show **Turn into eval case**, and **In eval set** once a case exists. | unit (client) |
| AC-EVAL-29 | The AgentEditor shall have an Evals tab with metric tiles, case list, run history, Run evals (paid-call confirmation) and a link to the dashboard. | unit (client) |
| AC-EVAL-30 | If an id belongs to another workspace, then every eval endpoint shall respond 404. | integration (approval) |
| AC-EVAL-31 | The sidebar shall contain **Eval Dashboard** under SKILLS LAB linking to `/eval`, with agent picker, metrics, history and compare. | unit (client) |
| AC-EVAL-32 | The client shall render null metrics (and unknown cost) as "N/A", never as 0 % or 100 %. | unit (client) |
| AC-EVAL-33 | `cd server && pnpm verify:l06` shall run the L06 checks sequentially and exit non-zero on any failure. | manual |
| AC-EVAL-34 | The demo dataset shall contain ≥ 8 real cases (≥ 1 of each kind) for one agent, created through Accept/Dismiss + **Turn into eval case**, and ≥ 2 real `done` runs with different `prompt_sha`. | manual (`verify:l06 --live`) |
| AC-EVAL-35 | The scorer shall never match a kept finding whose range spans more than 50 lines. | unit |
| AC-EVAL-36 | The migration shall only add tables, NULLable columns without defaults, FKs and indexes, and existing `eval_cases`/`eval_runs` rows shall be unchanged after it. | manual (SQL review) + integration (approval) |

## 17. Risks and open questions

### 17.1 `verify:l06` (decision D2)

No lab instruction defines it, so this spec does. Placement: **a `verify:l06` script in `server/package.json`** →
`node ../scripts/verify-l06.mjs`, run as `cd server && pnpm verify:l06`. Reasons: `pnpm` is the server's package
manager; `server/package.json` is tracked and not skip-worktree (verified); a script entry does not touch
`pnpm-lock.yaml` (scripts are not in the lockfile); `scripts/` already holds repo-level tooling. A root
`package.json` is **not** needed and is not created: it would introduce a new top-level package in a repo that
deliberately has no workspace. The script runs sequentially (never in parallel, memory "no parallel package
commands"): server typecheck → server eval unit tests → client typecheck → client tests → contract-parity check of
the L06 block in both `eval-ci.ts` copies; `--it` adds `evals.it.test.ts` (Docker); `--live --agent <id>` adds
read-only GETs against `:3001` for AC-EVAL-34. It never calls a POST endpoint or an LLM.

### 17.2 Real dataset protocol (decision D1, demo step D1)

No status is ever written directly to the DB. All decisions go through the product UI (PR Detail → Findings →
**Accept** / **Reject**, which calls `POST /findings/:id/accept|dismiss`), by a human reading each finding:
1. Agent: **Test Reviewer** (16 real findings; prompt and skills are realistic for a later prompt change).
2. PRs: #3 (open), #4, #5, #1 — their diffs are recoverable (`pr_files` patches: 3, 99, 2, 59; git diff first).
3. Per PR, decide **every distinct location** of the Test Reviewer reviews (complete labeling — required by the
   closed-world precision, §8.4): Accept if the finding is a real problem in that diff, Reject if it is wrong, noise
   or out of scope. Repeated findings at the same location across PR #3's three reviews get the same decision.
4. On each decided finding click **Turn into eval case**. The server rejects repeated locations
   (`duplicate_location`) and ranges > 50 lines (`routes.ts:24-109`), so the set has one case per location.
5. Expected yield: ≈ 11 distinct, case-eligible locations (PR #3: `routes.ts:35`, `:36`, `:109`, `knowledge.ts:182`;
   PR #4: 3; PR #5: 3; PR #1: 1) ≥ 8. The must_find / must_not_flag split is whatever the honest decisions give;
   at least one of each is needed. If the honest decisions give < 8 eligible cases or no case of one kind, the
   fallback is **new real reviews** of the same agent on other open PRs (paid, separate approval), then repeat 3-4 —
   never flipping decisions to reach a quota.
6. `verify:l06 --live --agent <Test Reviewer id>` confirms ≥ 8 cases and both kinds.

### 17.3 Risks

- R1. **No decided findings exist yet** (0/34) — handled by 17.2; it needs ~16 manual decisions.
- R2. LLM non-determinism: deltas of a few points may be noise; the compare view shows per-case flips; recommend 2 runs per prompt when time allows.
- R3. Closed-world precision is a lower bound: a correct but never-labeled new finding counts as FP. Mitigated by complete labeling (17.2) and the visible FP breakdown; the bias is the same for both prompts, so comparisons stay fair.
- R4. must_not_flag is location-only: a *different*, legitimate issue on dismissed lines counts as `negative_hit` (Q4).
- R5. Diff drift (A1) if the PR head moved between review and case creation; `location_not_in_diff` catches the worst case.
- R6. `db:generate` could emit unrelated drift; the eval tables and the table count of `0014_snapshot.json` match the schema, but other columns were not diffed — inspect the generated SQL against the §5 contract before keeping it.
- R7. Contract copies differ already; the new block is appended identically to both and checked by `verify:l06`.
- R8. Paid calls in the demo: cost ≈ 4 distinct PRs × 1 review per run (deepseek-v4-flash); each run needs explicit approval.
- R9. `AGENTS.md` and `TESTING.md:89` say `server/package.json` is skip-worktree, which is no longer true; fixing the docs needs approval (not part of this plan).

### 17.4 Decisions to confirm

- D1. Closed-world precision (`FP = kept − TP`, FP reasons shown) — replaces the earlier open-world proposal.
- D2. `verify:l06` in `server/package.json` + `scripts/verify-l06.mjs`; no root `package.json`.
- D3. Width limit 50 lines for expectations (creation) and for matchable findings (scoring).
- Q2. Skills frozen and included in eval runs (*recommended*) vs excluded.
- Q4. must_not_flag matched by location only (*recommended*) vs location + category.
- Q5. Keep the spec at `specs/eval-pipeline.md` (requested) instead of the convention `specs/<slug>/spec.md`.
- Q6. Demo agent Test Reviewer and the 17.2 protocol.

Approvals required: schema change + migration `0015` generation (G3); running integration tests (Docker); widening
`MockLLMProvider` id type (test adapter); adding the `verify:l06` script to `server/package.json`; every paid eval run
(and any fallback review) in the demo. No new dependency is planned (sha256 via `node:crypto`, LCS diff hand-written,
charts via the existing `recharts` wrappers).
