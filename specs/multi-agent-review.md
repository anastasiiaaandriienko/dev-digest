# Spec: Multi-Agent Review (L07 lab, worktree A)
- **Key:** MAR · **Status:** Draft v4 — plan gaps closed, technical decisions A-T1…A-T6 recorded · **Date:** 2026-10-23 · **Packages:** server | client | contracts
- **Source request:** L07 lab "Multi-Agent Review + Export to CI via git worktree fan-out", worktree A. The user asked for it through the main agent. The instructor asked to keep it simple. User decisions applied on 2026-10-23 (§14).

## 1. Goals
- G1. Run a user-chosen set of reviewer agents on one PR as one grouped run. `multi_agent_runs` is the parent; child `agent_runs` rows are linked via `agent_runs.multi_agent_run_id`. The agents run in parallel.
- G2. Choose agents in two places: the PR-page picker and the "Configure run" screen. Configure run shows a time and cost estimate based on past runs.
- G3. A Results page for the LATEST multi-run of a PR. It has two modes (Columns / Tabs + detail), live statuses for each agent, a "View trace" link for each agent and a "Where agents disagree" block.
- G4. Group findings across agents (same file + overlapping line ranges). Original findings and their agent attribution are kept.
- G5. Measure 1 agent against 3 agents on the same PR and record the real numbers in §17.

## 2. Non-goals
- No "Reply to author" button (the instructor dropped it).
- No "similar gist" text matching (simplest viable rule only).
- No view of older multi-runs (only the latest is shown).
- No "cancel all" action.
- Nothing owned by B per S.4: `server/src/modules/ci/**`, `agent-runner/**`, the CI tab, the CI Runs page, `eval-ci.ts`.
- No Memory or Agent Performance pages.
- No "learn" backend.
- No real git-worktree fan-out at runtime: runs fan out in-process. The header label "fan-out via worktrees" is design flavour (AC-MAR-49).

## 3. Actors and triggers
| Actor | Trigger |
|---|---|
| Studio user | PR page → Run Review picker → "Run multi-agent review (N)"; sidebar → Multi-Agent Review → Configure run → CTA; Results → Start new review / Configure run; finding actions; View trace |
| Server (`ReviewService` + `ReviewRunExecutor`) | `POST /pulls/:id/review` with `agentIds`; background parallel execution |
| Client live layer | SSE `GET /runs/:id/events` for each run; refetch when a run settles |
| Worktree B (Export to CI) | Writes `agent_runs` rows with `source='ci'` and `multi_agent_run_id = NULL` (S.3). A's views must tolerate them (AC-MAR-55, 56). |

## 4. Current state (verified, path:line)
- **Run request.**
  - `RunRequest` = `{agentId?, all?}` (`server/src/vendor/shared/contracts/platform.ts:392-395`).
  - The route parses it and resolves targets (`server/src/modules/reviews/routes.ts:32-48`), with a per-route rate limit of 10 per minute (`:34`).
  - `all` → enabled agents. A single `agentId` may be a disabled agent. Neither field set → 400 `invalid_run_request` (`server/src/modules/reviews/service.ts:48-59`).
- **Run creation and execution.**
  - `runReview` creates the `agent_runs` rows up front and fires the executor without awaiting it (`service.ts:105-140`).
  - The response is `ReviewRunResponse {pr_id, runs[], reviews[]}` (`server/src/vendor/shared/contracts/review-api.ts:47-59`).
  - `executeRuns` loads the diff once and the intent once, using one fanned-out `RunLogger` (`server/src/modules/reviews/run-executor.ts:104-164`).
  - It then runs the agents one after another in a `for` loop (`:166-203`). Each agent's failure is isolated (`:194-202`). A diff failure fails every run (`:126-151`).
- **Traces.** Traces carry `source: 'local'` (`run-executor.ts:422,698`) and `RunStats {duration_ms, tokens_in, tokens_out, findings, grounding, cost_usd}` (`server/src/vendor/shared/contracts/trace.ts:118-127`). Grounding drops are logged as `grounding dropped "<title>": <reason>` (`reviewer-core/src/review/run.ts:210`).
- **Schema.**
  - `multi_agent_runs` has only `id, workspace_id, pr_id, ran_at` (`server/src/db/schema/runs.ts:41-50`).
  - `agent_runs` has `agent_id`, `source ('local'|'ci')` and, since migration 0016, `multi_agent_run_id` (`server/src/db/schema/runs.ts:33-38`).
  - No module uses `multi_agent_runs` yet (only `server/src/db/schema.ts:41,88`).
  - Migration `0016_l07_multi_agent_ci.sql` (S.2) already exists: it was created in the pre-fan-out prep commit 5eee208 (S.1) and is applied to worktree A's isolated database `devdigest_multi_agent`. Worktree A does not create or change any migration.
- **Existing contracts.**
  - `AgentColumn`, `AgentColumnFinding`, `Conflict`, `ConflictTake` and `MultiAgentRun` already exist and are identical in both copies (`{server,client}/src/vendor/shared/contracts/observability.ts:23-86`).
  - Their comments name endpoints that do not exist.
  - Conflict definition (`:61-65`): one agent flagged a location and another did not, or severities diverge.
- **Findings and actions.**
  - `Finding` has `start_line, end_line, confidence (0..1), suggestion, category` (`findings.ts:47-62`).
  - `ReviewRecord` has `agent_id, run_id, agent_name` (`review-api.ts:25-39`).
  - `FindingActionKind` includes `learn` (`findings.ts:82`), but only `accept|dismiss` routes exist (`reviews/routes.ts:22,172-178`).
  - `POST /findings/:id/eval-case` freezes a *decided* finding (`server/src/modules/evals/routes.ts:22,47`).
- **Client.**
  - `useRunReview` posts `{agentId}|{all}` (`client/src/lib/hooks/reviews.ts:201-213`).
  - `useRunEvents` opens one EventSource per run (`:321-334`).
  - `RunReviewDropdown` lists all agents, incl. disabled ones (`RunReviewDropdown.tsx:51-61`). "Configure agents" there goes to `/agents` (`:81`).
  - Findings are grouped by run only (`FindingsTab.tsx:146`).
- **Sidebar.**
  - `NAV` has only the WORKSPACE and SKILLS LAB groups (`client/src/vendor/ui/nav.ts:21-41`).
  - The label `shell.json:26` "multi-agent" and the `activeKeyFor` match for `/multi-agent` (`client/src/components/app-shell/helpers.ts:28`) already exist.
  - Stale strings exist in `client/messages/en/runs.json:156-180`.
- **Cost and estimates.**
  - Run cost per PR = sum over `done` runs from `run_traces.trace.stats.cost_usd`, with a partial flag (`server/src/modules/pulls/cost.ts:18-59`).
  - Stale `running` runs are reaped on boot (`server/src/app.ts:83`).
  - No per-agent estimate endpoint exists.

## 5. Inputs and provenance
| Input | Source | Trust | Validation / limits |
|---|---|---|---|
| `:id` PR id | URL | untrusted | `IdParams` uuid; PR in the caller's workspace |
| `agentIds[]` | request body | untrusted | strings, de-duplicated keeping first occurrence, 1..`MAX_AGENTS_PER_RUN` = 8, each an agent of the workspace (enabled or disabled); not combined with `agentId`/`all` |
| Agent name/description | DB `agents` (user-authored) | semi-trusted | rendered as text |
| Findings (title, rationale, suggestion) | LLM output on an untrusted diff | untrusted | existing markdown renderer, no raw HTML |
| Past runs (duration, cost) | `agent_runs` + `run_traces` | trusted (own DB) | `done` runs only; last `ESTIMATE_WINDOW` = 10 per agent |
| `?pr=`, `?view=`, `?trace=` | URL | untrusted | unknown values fall back to defaults |

## 6. Outputs (contracts, UI, persistence, trace)
- **Persistence.**
  - A request with `agentIds` writes 1 `multi_agent_runs` row and N child `agent_runs` rows with `multi_agent_run_id` set. The column is defined by migration 0016 (S.2), created in the pre-fan-out prep commit (S.1), not by worktree A.
  - Findings and reviews are unchanged (S.3).
- **Contracts (edit BOTH copies; only files A owns per S.4):**
  - `platform.ts`: `RunRequest.agentIds?: string[]`.
  - `observability.ts`:
    - New `MultiAgentStartResponse = ReviewRunResponse.extend({multi_agent_run_id: string | null})`. This keeps `review-api.ts` untouched.
    - `AgentColumn.status` gains `cancelled`, and the column gains `error`.
    - `AgentColumnFinding` gains `end_line, rationale, suggestion, confidence, review_id, accepted_at, dismissed_at, eval_case_id`.
    - New `FindingGroup {file, start_line, end_line, title, members[{finding_id, run_id, agent_id, agent_name, severity, title}], takes: ConflictTake[]}`. `takes` holds one take per column, computed with the same rule as for `Conflict` (AC-MAR-16), so the client never re-implements it.
    - `Conflict` gains `start_line`/`end_line`.
    - `ConflictTake.verdict` gains `no_result`; `ignored` means "did not flag".
    - `MultiAgentRun` gains `groups[]`, `wall_clock_ms`, `cost_partial`.
    - New `AgentEstimate {agent_id, runs, avg_duration_ms|null, avg_cost_usd|null}`.
- **API (all in `server/src/modules/reviews/**`, so no new module and no `modules/index.ts` change):**
  - `POST /pulls/:id/review` (extended).
  - `GET /pulls/:id/multi-agent` → `{multi_run: MultiAgentRun | null}` (latest).
  - `GET /multi-agent/estimates` → `AgentEstimate[]`.
- **UI routes (accepted A1):**
  - Configure run: `/repos/[repoId]/multi-agent?pr=<prId>`.
  - Results: `/repos/[repoId]/pulls/[number]/multi-agent?view=columns|tabs&trace=<runId>`.
- **Trace:** unchanged shape. Each child run keeps its own `run_traces` row.

## 7. Functional requirements
- FR-1 Start a subset run with `agentIds` and create the parent multi-run → AC-MAR-01..04.
- FR-2 Parallel, isolated execution (cap 4) with complete traces → AC-MAR-05..08.
- FR-3 Read the latest multi-run with totals; only linked runs are included → AC-MAR-09..11, 17, 18, 53, 55, 57.
- FR-4 Grouping and disagreement → AC-MAR-12..16, 54.
- FR-5 Estimates from past runs → AC-MAR-19, 20, 56.
- FR-6 PR-page picker and link → AC-MAR-21..27.
- FR-7 Configure run screen → AC-MAR-28..31.
- FR-8 Results page → AC-MAR-32..47, 49, 58.
- FR-9 Navigation and i18n → AC-MAR-48, 50.
- FR-10 Measurement → AC-MAR-52.

**Grouping rule (FR-4):**
- Two findings belong to the same group when they have the same `file` and overlapping inclusive ranges `[start_line, end_line]`. Grouping is transitive (connected components).
- An agent "flagged" a group if any of its findings is a member. That agent's take is its highest-severity member, and the cell note is that finding's title.
- A group's title is the title of the member with the highest severity, ties broken by column order.
- A group "involves" an agent that flagged it. The disagree block shows:
  - toggle ON (default): conflicts only;
  - toggle OFF: every group flagged by ≥2 agents, plus every conflict.

## 8. Constraints
- **Ownership and merge order:** exactly as S.4 / S.5 (shared section below). This spec adds no other ownership rules.
- **Schema:** A creates or edits no migration and no `server/src/db/**` file. Any further schema need → stop and ask (S.1).
- **Attribution columns:** A must not rename or remove `agent_runs.agent_id` / `agent_runs.source`, or change their meaning (S.3).
- **CI runs are not deletable from the studio:** `DELETE /runs/:id` rejects `source='ci'` runs with 409 (AC-MAR-59). The rule lives in A's `server/src/modules/reviews/**` (owner A per S.4); B relies on it and does not touch `reviews/**`. Reason: `ci_runs.agent_run_id` is `ON DELETE CASCADE` (S.2), so a delete would erase CI history and the next Sync would re-ingest the run.
- **Legacy requests:** `{agentId}` / `{all:true}` keep their behaviour and create no multi-run. The rate limit stays at 10 per minute.
- **Concurrency:** `MAX_AGENTS_PER_RUN = 8`. Concurrency cap `REVIEW_CONCURRENCY = 4` inside `executeRuns`. The cap also applies to the `all` path, which shares the executor.
- **Safety:** no new dependencies and no lockfile changes. No paid LLM calls in tests (`MockLLMProvider` or fakes).
- **Conventions:**
  - Server: kebab-case, `.js` imports, single quotes, `workspaceId` scoping.
  - Client: `Name/Name.tsx` folders, double quotes, strings in `client/messages/en/*.json`.
- **A-side files inside the S.4 areas (detail, not new ownership):**
  - Server: `server/src/modules/reviews/multi-run/{service,repository,helpers,constants}.ts` and extended `reviews/{routes,service,run-executor}.ts`.
  - Client pages: `client/src/app/repos/[repoId]/multi-agent/**` and `client/src/app/repos/[repoId]/pulls/[number]/multi-agent/**`; the `RunReviewDropdown` picker; the PR header link.
  - Client hooks and strings, which neither spec assigns to B: `client/src/lib/hooks/multi-agent.ts` and `reviews.ts`; `client/messages/en/multiAgent.json`.
  - Tests: `server/test/**/multi-run*.test.ts` + `*.it.test.ts`; co-located client tests.
- **Verification (sequential, never in parallel):**
  - `cd server && pnpm typecheck`
  - `pnpm exec vitest run --exclude '**/*.it.test.ts'`
  - `pnpm exec vitest run .it.test` (Docker)
  - `cd client && pnpm typecheck && pnpm test`
  - `cd reviewer-core && npm run typecheck && npm test`
  - `cd server && pnpm verify:l06`

## 9. Security
- Every query is scoped by `workspaceId` from `getContext()`. An agent id or PR id from another workspace returns 404.
- No new text is added to any LLM prompt.
- Finding text (LLM output on untrusted input) is rendered with the existing markdown renderer, with no `dangerouslySetInnerHTML`.
- No secrets in DTOs or traces. The column `error` is the stored `agent_runs.error`.

## 10. Performance
- Wall-clock for N agents ≈ shared pre-work + ceil(N/4) waves of the slowest agents. Do not assert a speed-up factor: real numbers go in §17.
- `GET /pulls/:id/multi-agent`: no latency target (decision Q11). The observed latency is recorded in §17. Grouping is O(f²) per file over one multi-run's findings.

## 11. Error handling and failure modes
| Failure | Behaviour | AC |
|---|---|---|
| Unknown or foreign agent id | 404, no rows | 02 |
| Empty / >8 / mixed body | 400 `invalid_run_request`, no rows | 03 |
| `DELETE /runs/:id` on a `source='ci'` run | 409 `ci_run_not_deletable`; run, trace, reviews and `ci_runs` row untouched (GitHub is the source of truth; deleting would cascade to `ci_runs` and the next Sync would re-ingest the run) | 59 |
| One agent's LLM fails or times out | That column is `failed` with its error; the others continue | 06, 35 |
| Diff load fails | Every child fails (existing `failAll`); every column shows the error | 06, 35 |
| Server restart mid-run | The boot reaper marks runs failed; shown as failed on revisit | 45 |
| SSE drops | The column falls back to the persisted status after refetch | 34, 45 |
| No past runs for an agent | "no estimate"; excluded from the totals, with a note | 19, 20 |
| CI rows / unlinked rows in `agent_runs` | Ignored by multi-run reads; no error | 55, 56 |
| No multi-run for the PR | Empty state + Start new review | 46 |
| Start request fails (429/4xx/5xx) | Error toast; selection kept | 26 |
| Child run deleted | Its column disappears | 57 |
| Partial results while running | Disagree block marked partial | 44 |

## 12. Acceptance criteria (EARS)
| AC-ID | EARS statement | Verification |
|---|---|---|
| AC-MAR-01 | When `POST /pulls/:id/review` receives a valid `agentIds` list, the server shall de-duplicate it (keeping the first occurrence), create one `multi_agent_runs` row and one `agent_runs` row per agent with `multi_agent_run_id` set to that row, and return `multi_agent_run_id` plus one `runs[]` entry per agent in list order. | integration (approval) |
| AC-MAR-02 | If any id in `agentIds` is not an agent of the caller's workspace, then the server shall return 404 and create no rows. | integration (approval) |
| AC-MAR-03 | If `agentIds` is empty, holds more than 8 distinct ids, or is combined with `agentId`/`all`, then the server shall return 400 `invalid_run_request` and create no rows. | unit |
| AC-MAR-04 | When the body is `{agentId}` or `{all:true}`, the server shall resolve targets as today, create no `multi_agent_runs` row, leave `multi_agent_run_id` NULL on the created runs, and return `multi_agent_run_id: null`. | integration (approval) |
| AC-MAR-05 | When `executeRuns` receives ≥2 jobs, the executor shall run up to 4 agent reviews at the same time, and shall start the next queued agent as soon as one finishes. | unit |
| AC-MAR-06 | If one agent's run fails or is cancelled, then the executor shall let every other run reach its own terminal status. | unit |
| AC-MAR-07 | The executor shall load the PR diff and resolve the intent once per request, whatever the number of agents. | unit |
| AC-MAR-08 | When a child run finishes, the server shall persist its trace with `source: 'local'`, `stats.tokens_in/out`, `stats.cost_usd`, `stats.grounding` and every grounding-drop log line. | unit |
| AC-MAR-09 | When `GET /pulls/:id/multi-agent` is called, the server shall return the `multi_agent_runs` row with the latest `ran_at` for that PR, with one column per linked child run (status, error, score, summary, duration, cost, findings with detail fields), `groups`, `conflicts` and totals. | integration (approval) |
| AC-MAR-10 | If the PR has no multi-run, then the server shall return `{multi_run: null}` with 200. | integration (approval) |
| AC-MAR-11 | If the PR is not in the caller's workspace, then the server shall return 404. | integration (approval) |
| AC-MAR-12 | The grouping helper shall place two findings in one group when their `file` is equal and their inclusive line ranges overlap, transitively. | unit |
| AC-MAR-13 | The grouping helper shall place findings with different files or non-overlapping ranges in different groups. | unit |
| AC-MAR-14 | The grouping helper shall include every input finding exactly once, keep `finding_id, run_id, agent_id, agent_name`, and never write to `findings`/`reviews`. | unit |
| AC-MAR-15 | The server shall mark a group as a conflict when at least one `done` agent flagged it and another `done` agent did not, or when the flagging agents' highest severities differ. | unit |
| AC-MAR-16 | For every group in `groups` (conflict or not) and every `Conflict`, the server shall return `takes` with exactly one take per column: the highest severity + finding title if flagged, `ignored` if `done` and not flagged, `no_result` if failed/cancelled/running. | unit |
| AC-MAR-17 | The server shall report `total_cost_usd` as the sum of known child costs, `cost_partial=true` when any `done` child cost is unknown, and null when none is known. | unit |
| AC-MAR-18 | The server shall report `wall_clock_ms` = max(ran_at+duration) − min(ran_at) over terminal children, and `total_duration_ms` = the sum of child durations. | unit |
| AC-MAR-19 | When `GET /multi-agent/estimates` is called, the server shall return, for each workspace agent, the average duration and average known cost over its last 10 `done` runs with `source='local'` (CI runs are excluded), or nulls when there are none. | integration (approval) |
| AC-MAR-20 | The Configure screen shall show the total estimate as max(selected durations) and sum(selected costs), labelled "parallel", and mark agents without an estimate as "no estimate", excluding them from the totals. | unit |
| AC-MAR-21 | When the user opens Run Review on the PR page, the client shall list every workspace agent with a checkbox under "PICK AGENTS TO RUN", pre-checking enabled agents and labelling disabled ones "disabled" (still checkable). | unit |
| AC-MAR-22 | The picker CTA shall read "Run multi-agent review (N)" with N = checked agents, and shall be disabled when N = 0. | unit |
| AC-MAR-23 | When the user clicks "Clear", the picker shall uncheck every agent. | unit |
| AC-MAR-24 | When the user clicks "Configure agents…" in the picker, the client shall navigate to Configure run with `?pr=` set to the current PR id. | unit |
| AC-MAR-25 | When a multi-run start from the picker or Configure run succeeds, the client shall navigate to that PR's Results page. | unit |
| AC-MAR-26 | If the start request fails, then the client shall show an error toast with the API message and keep the selection. | unit |
| AC-MAR-27 | While the PR has at least one multi-run, the PR page shall show a link to its Results page; otherwise the link is hidden. | unit |
| AC-MAR-28 | While no PR is selected, Configure run shall show "Pick a pull request first" in step 2 and disable the CTA. | unit |
| AC-MAR-29 | When a PR is selected, Configure run shall show one card per agent (icon, name, `agents.description`, estimate, checkbox; enabled agents pre-checked) and a "Select all" action that checks all cards. | unit |
| AC-MAR-30 | The PR select shall list the stored PRs of the active repo and preselect `?pr=` when it matches. | unit |
| AC-MAR-31 | If the workspace has no agents, then Configure run shall show an empty state linking to `/agents`. | unit |
| AC-MAR-32 | The Results header shall show a "Configure run" back button, the title, "N selected agents · parallel", the PR "#number title", the summary "N agents · wall-clock · total cost", and a Columns/Tabs toggle persisted in `?view` (default `columns`). | unit |
| AC-MAR-33 | In Columns mode, the Results page shall render one column per child run, in AC-MAR-53 order, with name, duration, cost, score ring, finding cards (severity icon, title, file:line), and a footer with "View trace" and "N findings". | unit |
| AC-MAR-34 | While a child run is running, its column shall show the live phase from `useRunEvents` and a `LiveLogStream`, and on that run's SSE `done` the client shall refetch the multi-run. | unit |
| AC-MAR-35 | If a child run is failed or cancelled, then its column shall show that status and the stored error, keep "View trace", and leave the other columns unchanged. | unit |
| AC-MAR-36 | When the user clicks "View trace", the client shall open `RunTraceDrawer` for that run id via `?trace=`. | unit |
| AC-MAR-37 | In Tabs mode, the page shall show one tab per agent (name + score), and for the selected agent a header (score ring, summary, View trace, time, cost) and expandable finding cards (severity, category, file:line, confidence %, rationale, suggested fix). | unit |
| AC-MAR-38 | When the user clicks Accept or Dismiss on a finding, the client shall call the existing `POST /findings/:id/(accept|dismiss)`, show the decision, and invalidate the multi-run query. | unit |
| AC-MAR-39 | When the user clicks "Turn into eval case", the client shall open the existing `AddToEvalModal` under its existing preconditions. | unit |
| AC-MAR-40 | The Results page shall render "Learn" as a disabled button with the tooltip "Learning from findings is not available yet", and shall send no request when it is clicked. | unit |
| AC-MAR-41 | The Results page shall not render a "Reply to author" action. | unit |
| AC-MAR-42 | The disagree block shall render each listed group — a conflict, or (toggle OFF) a non-conflict group flagged by ≥2 agents — as `file:line` + title followed by one cell per agent taken from that group's server-side `takes`: severity + finding title, "did not flag" with no reason text, or "no result". | unit |
| AC-MAR-43 | While "Show only conflicts" is on (the default), the block shall list only conflicts; while it is off, it shall list every group flagged by ≥2 agents plus every conflict. | unit |
| AC-MAR-44 | While any child run is not terminal, the disagree block shall state that it is computed over finished agents only. | unit |
| AC-MAR-45 | When the Results page is (re)loaded, the client shall show the latest multi-run and subscribe to SSE only for its non-terminal runs. | unit (RTL: reload with mixed statuses → `useRunEvents` only for non-terminal ids) + manual reload check; no e2e, the seed is not changed |
| AC-MAR-46 | If the PR has no multi-run, then the Results page shall show an empty state with "Start new review". | unit |
| AC-MAR-47 | When the user clicks "Start new review" or "Configure run", the client shall open Configure run with `?pr=` set to the current PR. | unit |
| AC-MAR-48 | The sidebar shall contain a GLOBAL section, created by A in `nav.ts`, holding a "Multi-Agent Review" item that opens `/repos/:repoId/multi-agent` and is active on `/multi-agent` routes. B later adds "CI Runs" to that section (S.4). | unit |
| AC-MAR-49 | The Results summary shall not claim "fan-out via worktrees"; it shall say "parallel". | unit |
| AC-MAR-50 | The client shall take every new user-facing string from `client/messages/en/*.json`. | unit |
| ~~AC-MAR-51~~ | (removed: covered by the §8 "no paid LLM in tests" constraint) | n/a |
| AC-MAR-52 | When the measurement is performed, the team shall fill in the §17 table for 1 agent vs 3 agents on the same PR head SHA. | manual |
| AC-MAR-53 | The server shall order columns by child `ran_at` ascending (rows are inserted in `agentIds` order), tie-broken by run id. | integration (approval) |
| AC-MAR-54 | For an `ignored` take, the server shall return an empty note, and the client shall show only "did not flag". | unit |
| AC-MAR-55 | The multi-run read shall include only `agent_runs` whose `multi_agent_run_id` equals that multi-run's id. Rows with NULL `multi_agent_run_id` (including `source='ci'`) never appear in columns, groups or conflicts. | integration (approval) |
| AC-MAR-56 | If `agent_runs` contains `source='ci'` rows or rows with NULL `pr_id`, then `GET /multi-agent/estimates` and `GET /pulls/:id/multi-agent` shall still succeed, and `source='ci'` runs shall not change any estimate (Q13 decision). | integration (approval) |
| AC-MAR-57 | When a child run is deleted (`DELETE /runs/:id`), the next multi-run read shall omit its column and recompute groups, conflicts and totals. | integration (approval) |
| AC-MAR-58 | While a multi-run has more than 4 columns, Columns mode shall scroll horizontally instead of shrinking columns. | unit |
| AC-MAR-59 | If `DELETE /runs/:id` targets an `agent_runs` row with `source='ci'`, then the server shall respond 409 `ci_run_not_deletable` and leave that run, its `run_traces` row, its reviews/findings and the linked `ci_runs` row unchanged. For runs with `source='local'` the existing delete behaviour (reviews + run + trace removed, `{ ok }` response) shall stay unchanged. Implemented by worktree A in `server/src/modules/reviews/**` (S.4). | integration (approval) |

## 13. Test scenarios
- S1 Subset start: 3 agents (one duplicated) → 1 parent, 3 linked runs, response `multi_agent_run_id` (AC-01). Foreign agent → 404 (02). Empty / 9 ids / mixed → 400 (03). Legacy bodies → no parent, NULL link (04).
- S2 Executor with a fake LLM using deferred promises:
  - 6 jobs → exactly 4 in flight; the 5th starts when one resolves (05).
  - Agent 2 throws; the others end `done` (06).
  - One diff load (07). Trace stats and grounding lines are present (08).
- S3 Read:
  - Two multi-runs → the latest is returned (09). None → null (10). Other workspace → 404 (11).
  - Order (53). An unlinked local run and a `source='ci'` run on the same PR are excluded (55, 56). A deleted child is omitted (57).
- S4 Grouping table tests: overlap/adjacent/disjoint/transitive/different file (12, 13). Attribution kept (14). Conflict and take rules incl. `no_result` and the empty note (15, 16, 54). Totals (17, 18).
- S5 Estimates: no history → null; only the last 10 used (19). Client totals max/sum (20).
- S6 Client RTL with mocked hooks:
  - Picker (21-27), Configure (28-31).
  - Results header / columns / tabs / actions incl. Learn disabled and no Reply (32-44, 46-47, 49, 50, 58).
  - Sidebar GLOBAL item (48).
- S7 Reload restore (45): an RTL test renders the Results page with a mocked multi-run whose columns are mixed (`done`, `failed`, `running`, `running`) and asserts `useRunEvents` is subscribed only for the two running ids; plus a manual check (reload the Results page while agents run). No e2e flow and no `server/src/db/seed.ts` change (the seed belongs to neither worktree, S.4; `e2e/CLAUDE.md` forbids editing it to make a flow pass).
- S8 CI-run delete guard (integration, `*.it.test.ts`, throwaway Testcontainers DB): seed a `source='ci'` run with a trace, a review and a linked `ci_runs` row → `DELETE /runs/:id` returns 409 `ci_run_not_deletable`, and all four rows still exist with identical contents; seed a `source='local'` run → `DELETE /runs/:id` returns 200 `{ ok: true }` and its run, trace and reviews are gone (59). A unit test on `ReviewService.deleteRun` with a mocked repository asserts the repository delete is never called for a CI run (59).
- S-M Measurement (manual, paid, explicit approval; use the test agent and an open PR with a real diff):
  - Runs: run 1 agent, then the same agent + 2 more, on the same PR and head SHA.
  - Fill in §17 and report the ratio as measured.

## 14. Decisions and accepted assumptions
Decisions (user, 2026-10-23):
- **Q1:** one shared migration 0016 before the fan-out, schema exactly as S.2. It was created in the prep commit S.1 (5eee208), not by A, and is applied to A's isolated database `devdigest_multi_agent`.
- **Q2:** "Learn" is a disabled button with a tooltip; no backend (AC-MAR-40).
- **Q3:** attribution per S.3. A keeps `agent_id`/`source`, and A's views tolerate NULL-link and CI rows (AC-MAR-55, 56).
- **Nav:** A creates the GLOBAL sidebar section with "Multi-Agent Review"; B later adds "CI Runs" (AC-MAR-48).
- **Q4 = A:** only `agentIds` creates a multi-run (AC-MAR-04).
- **Q5 = B:** toggle ON by default = conflicts only; OFF = ≥2-agent groups plus conflicts (AC-MAR-43).
- **Q6 = B:** max 8 agents, concurrency cap 4 (AC-MAR-03, 05).
- **Q7:** estimates use the last 10 `done` runs (AC-MAR-19).
- **Q8 = A:** "Configure agents…" opens Configure run with `?pr=` (AC-MAR-24).
- **Q9 = A:** no reason text for "did not flag" (AC-MAR-42, 54).
- **Q10 = A:** columns follow the selection order (AC-MAR-53).
- **Q11:** no latency target; record only (§10, §17).
- **Q12 = A:** measurements are recorded in the appendix of this spec (§17).

Accepted assumptions (user, 2026-10-23):
- **A1:** the routes in §6.
- **A2:** enabled agents are pre-checked, and disabled ones can be checked (AC-MAR-21, 29).
- **A3:** a successful start navigates to Results (AC-MAR-25).
- **A4:** duplicate `agentIds` are de-duplicated (AC-MAR-01).
- **A5:** card text comes from `agents.description` (AC-MAR-29).
- **A6:** a deleted child run removes its column (AC-MAR-57).
- **A7:** more than 4 columns scroll horizontally (AC-MAR-58).

Technical decisions (user, 2026-10-23; from the development plan — implementation detail only, no functional change):
- **A-T1 Column order:** the parent and all child `agent_runs` are inserted in ONE transaction, and each child gets an explicit `ran_at = t0 + i ms` (i = position in the de-duplicated `agentIds`). Postgres `now()` is the transaction start time, so `defaultNow()` would give every child the same `ran_at`. Resolves R2; verified by AC-MAR-53.
- **A-T2 Malformed ids:** an id in `agentIds` that is not a uuid is answered with 404 (as an unknown agent, AC-MAR-02) without a DB query, so Postgres never sees a malformed uuid (no 500).
- **A-T3 SSE budget:** the Results page keeps at most `MAX_LIVE_STREAMS = 4` EventSources — the first ≤4 non-terminal columns in column order (HTTP/1.1 allows 6 connections per origin). Because the executor starts jobs in list order with a cap of 4, these are exactly the agents in flight; other non-terminal columns refresh via a 4 s poll (AC-MAR-34, 45).
- **A-T4 PR-page picker:** the checkbox picker replaces the old "Run all enabled agents" / single-agent menu items in `RunReviewDropdown`. The server keeps `{agentId}` / `{all:true}` (AC-MAR-04); the MCP server uses `{agentId}` and ignores the extra `multi_agent_run_id` field.
- **A-T5 Agent icon/colour:** the `Agent` contract has no icon or colour, so cards use the `Cpu` icon and a colour from a fixed palette indexed by a hash of the agent id (AC-MAR-29). Resolves the icon/colour part of R4.
- **A-T6 Finding actions:** Tabs mode reuses `FindingCard` (Accept/Dismiss, Turn into eval case — `AddToEvalModal` requires a decided finding); the disabled "Learn" button (AC-MAR-40) is added through a new optional `extraActions` slot on `FindingCard`.

## 15. Open questions and risks
No open questions.

Decision (user, 2026-10-23):
- Q13 → A: only `source='local'` runs feed the Configure-run estimates (AC-MAR-19, AC-MAR-56); CI timing and cost come from a different environment.
- Technical decision confirmed: the start response type `MultiAgentStartResponse = ReviewRunResponse.extend({multi_agent_run_id})` lives in `observability.ts`, so `review-api.ts` stays untouched (§6).
- Technical decision confirmed: the estimates route is `GET /multi-agent/estimates`, implemented under `server/src/modules/reviews/**` (AC-MAR-19, S.4).
- CI-run deletion → option A: keep `ON DELETE CASCADE` on `ci_runs.agent_run_id` (migration 0016 unchanged) and reject `DELETE /runs/:id` for `source='ci'` runs with 409 in worktree A (AC-MAR-59).

Risks (planning/verification, not user questions):
- R1 `runOneAgent` narrows the shared `RunLogger` per run. Checked in planning: `forRun` creates a new single-run logger (`server/src/platform/run-logger.ts:45-47`) and the RunBus keeps a buffer and sequence per run; the implementation must still assert per-run trace logs under concurrency (AC-MAR-05, 08).
- R2 Column order: resolved by A-T1 (explicit `ran_at` in one transaction); verified by AC-MAR-53.
- R3 The concurrency cap also changes `all:true` timing.
- R4 Icon/colour resolved by A-T5 and `AddToEvalModal` preconditions by A-T6. Still to confirm during implementation: whether `usePulls` (`client/src/lib/hooks/core.ts:100`) has the fields the PR select needs.

## 16. Approvals required
- Migration 0016 (S.2): already created in the prep commit 5eee208 (S.1) and applied to `devdigest_multi_agent`; no further migration approval is needed for A (A never runs `db:generate`).
- Contract changes in both vendored copies (`platform.ts`, `observability.ts`).
- Integration tests need Docker (Testcontainers). AC-MAR-45 has no e2e flow (S7).
- The S-M measurement makes paid LLM calls.

## 17. Measurement record (appendix, Q12) — S-M performed 2026-10-24 (T13)
Stack: worktree A at `fa5b298`, isolated `devdigest_multi_agent`, API :3111. PR: `anastasiiaaandriienko/sdd-consumer-demo` #4 (one new file `src/t8-unsafe-export.js`, +11). Values are taken from `GET /pulls/:id/multi-agent`, `agent_runs` and the run traces; nothing is estimated.

| Field | 1 agent | 3 agents |
|---|---|---|
| PR id / # / head SHA / date | `6043f121…` / #4 / `ddb02d8` (`ddb02d83f988e54385e48cd177acfd5f5e2176db`) / 2026-10-24; multi-run `bfbeed72…` | same PR and SHA (re-checked before the run) / 2026-10-24; multi-run `092a63d0…` |
| Agents (name, provider/model) | Security Reviewer, openrouter/deepseek/deepseek-v4-flash | Security, General, Performance Reviewer, all openrouter/deepseek/deepseek-v4-flash (agent settings unchanged) |
| Wall-clock (`wall_clock_ms`) | 10 437 ms | 15 682 ms |
| Sum of durations | 10 437 ms | 39 977 ms |
| Per-agent duration / tokens in / tokens out / cost | Security: 10 437 ms / 3 546 / 965 / $0.00018552688 | Security: 12 609 ms / 3 546 / 1 171 / $0.00019948544; General: 15 681 ms / 3 336 / 1 855 / $0.00023871848; Performance: 11 687 ms / 3 766 / 1 361 / $0.00021981344 |
| Total cost (+ `cost_partial`) | $0.00018552688 (false); tokens 3 546 / 965 | $0.00065801736 (false); tokens 10 648 / 4 387 |
| Findings kept / dropped by grounding, per agent | Security 1 / 0 (1 CRITICAL) | Security 1 / 0, General 1 / 0, Performance 2 / 0 — 3 CRITICAL + 1 WARNING |
| Groups / conflicts / locations flagged by one agent only | 1 / 0 / — | 1 / 0 / 0 (the Performance WARNING at line 8 falls inside the shared group `src/t8-unsafe-export.js:7-9`) |
| Observed `GET /pulls/:id/multi-agent` latency | not timed | 0.23 s |
| Measured ratio and notes | — | wall-clock ×1.50, sum of durations ×3.83 (parallelism 2.55), cost ×3.55, tokens in ×3.00 / out ×4.55 |

- Intent: generated once before the runs (527 / 175 tokens, $0.000085946, 7.4 s); every run's trace shows "intent: reused stored intent (no model call)", so it is excluded from both wall-clocks. Total spend of the measurement: **$0.00092949** (intent + both runs), matching the OpenRouter key usage delta; no retries (identical Security `tokens_in` in both runs).
- Observations: (1) duplication — all three agents reported the same command injection as CRITICAL; the 3-agent run added one WARNING (sync `exec` per request) for ×3.55 the cost; (2) the Performance Reviewer wrote its findings in Chinese (the prompt sets no output language); (3) the Performance Reviewer went outside its specialisation and reported the injection as a `security` CRITICAL; (4) the Security finding's range moved between runs (6-10 vs 7-9) — model non-determinism.
- Conclusion: parallel execution works as designed — three agents took ~1.5× the wall-clock of one, all columns completed, and grouping merged the overlapping findings into one group showing agreement (0 conflicts). On a one-file diff with a single obvious defect the extra agents mostly confirm the same finding, so cost and tokens grow ~linearly while new signal is small. The benefit is expected on larger, mixed diffs where personas cover different risks; that needs personas that stay in scope (and a fixed output language) and was not measured here.

## Shared with the sibling spec (L07 worktrees A + B) — identical in both specs

This section is copied verbatim into `specs/multi-agent-review.md` (A) and `specs/export-to-ci.md` (B). Change it in both files or in neither.

### S.1 Pre-fan-out preparation commit (on the base branch, BEFORE `git worktree add`)
One commit, made only after explicit user approval, containing exactly:
1. `server/src/db/schema/runs.ts` and `server/src/db/schema/ci.ts` changes listed in S.2.
2. The generated migration `server/src/db/migrations/0016_<drizzle-name>.sql` + `meta/0016_snapshot.json` + `meta/_journal.json` (via `pnpm db:generate`; never hand-written).
3. Both specs.
Neither worktree creates or edits a migration. A worktree that needs another schema change stops and asks.

### S.2 Migration 0016 — exact schema delta (created as `0016_l07_multi_agent_ci.sql` in prep commit 5eee208)
`agent_runs` (`server/src/db/schema/runs.ts`):
- `multi_agent_run_id uuid NULL` → FK `multi_agent_runs.id` ON DELETE SET NULL; index `agent_runs_multi_agent_run_id_idx`. Set by A for runs started with `agentIds`; NULL for single/`all` runs and for CI runs.
- (no other new columns; CI runs use the existing `source` = `'ci'`, `agent_id`, `status`, `findings_count`, `score`, `blockers`, `duration_ms`, `model`, `provider`; `pr_id` stays NULL when the PR is not imported into the studio.)

`ci_installations` (`server/src/db/schema/ci.ts`):
- `status text NOT NULL DEFAULT 'pending'` — `pending` (export PR opened) | `active` (≥1 ingested run) | `error`.
- `agent_version integer NULL` — agent version at export time (shown as "workflow version").
- `pr_url text NULL` — the export PR on `devdigest/ci`.
- `updated_at timestamptz NOT NULL DEFAULT now()`.
- `last_synced_at timestamptz NULL` — throttles automatic ingest (B, §ingest).
- unique index `ci_installations_agent_repo_target_uq` on (`agent_id`, `repo`, `target_type`). Deliberately NOT unique on (`repo`) alone: the DB already allows several agents per repo; the one-agent-per-repo rule is an MVP rule in the service + runner only.

`ci_runs` (`server/src/db/schema/ci.ts`):
- `agent_run_id uuid NULL` → FK `agent_runs.id` ON DELETE CASCADE; unique index `ci_runs_agent_run_id_uq`.
- `commit_sha text NULL`, `github_run_id bigint NULL`, `github_repo_id bigint NULL`.
- unique index `ci_runs_installation_github_run_uq` on (`ci_installation_id`, `github_run_id`) — idempotent ingest.

`multi_agent_runs`: unchanged.

### S.3 Attribution model
- Every review result, local or CI, is an `agent_runs` row attributed to its agent via `agent_id`; findings stay attributed through `reviews.run_id` / `reviews.agent_id` → `findings.review_id`.
- A (multi-agent): `agent_runs.multi_agent_run_id` groups child runs; findings are never copied or rewritten — grouping is computed on read.
- B (CI): one ingested GitHub Actions run = one `agent_runs` row (`source='ci'`, `agent_id` from the installation) + one `ci_runs` row (`agent_run_id`, `ci_installation_id`, `github_run_id`, `commit_sha`, `github_repo_id`, `pr_number`, `github_url`). "Ingest reads A's attribution" means: B relies on the `agent_runs` attribution columns and read paths as they exist after A merges (A must not rename/remove `agent_id`/`source`), and B's CI rows must render correctly in any agent_runs-based view A adds (they have `multi_agent_run_id = NULL`).

### S.4 File ownership
| Area | Owner | Notes |
|---|---|---|
| `server/src/modules/reviews/**` (multi-run service, executor, routes), PR page `client/src/app/repos/[repoId]/pulls/**`, Multi-Agent Review pages, `observability.ts` contracts (both copies), `platform.ts` `RunRequest` (both copies) | A | B must not touch |
| `server/src/modules/ci/**`, `agent-runner/**`, agent CI tab, CI Runs page, `eval-ci.ts` contracts (both copies), new `GitHubClient` methods in `server/src/vendor/shared/adapters.ts` + `server/src/adapters/github/octokit.ts` + `server/src/adapters/mocks.ts` | B | A must not touch |
| `client/src/vendor/ui/nav.ts` + `client/messages/en/shell.json` | A creates the GLOBAL section with the "Multi-Agent Review" item; B adds only the "CI Runs" item to that section after rebasing on A | expected, trivial conflict |
| `server/src/modules/index.ts` | A only if it adds a module; B adds the `ci` module registration | one-line additions |
| `server/src/db/**` | prep commit only (S.1) | nobody in A/B |

### S.5 Merge order
1. Prep commit (S.1) on the base branch → create both worktrees from it.
2. Merge A first; run its checks on the merged base.
3. Rebase B onto the new base; resolve only the expected conflicts (`nav.ts`, `shell.json`, `modules/index.ts`); re-run B's checks; merge B.
4. Full product check after both merges.

## 18. Mockup coverage
| Element | # | AC-IDs | Status | Note |
|---|---|---|---|---|
| Run Review button + dropdown on PR header | 1 | 21 | Covered | |
| "PICK AGENTS TO RUN" + agent checkboxes | 1 | 21 | Covered | enabled pre-checked |
| "Clear" | 1 | 23 | Covered | |
| "Run multi-agent review (2)" | 1 | 22, 25 | Covered | |
| "Configure agents…" | 1 | 24 | Covered | → Configure run `?pr=` |
| PR-page link to the latest multi-run (not drawn) | 1 | 27 | Covered | instructor requirement |
| Sidebar GLOBAL › "Multi-Agent Review" | 1-5 | 48 | Covered | Memory / Agent Performance out of scope; CI Runs added by B |
| Breadcrumb "Multi-Agent Review › Configure run" / "› #482" | 2-5 | 32, 48 | Covered | |
| Title + subtitle "Run a Multi-Agent Review" | 2 | 28 | Covered | |
| Step 1 "Pull request" select | 2, 3 | 30 | Covered | |
| Step 2 empty "Pick a pull request first" | 2 | 28 | Covered | |
| CTA disabled with no PR | 2 | 28 | Covered | "(4)" in the mockup is demo data |
| Agent cards: icon, name, description, colored border, checkbox | 3 | 29 | Covered | icon `Cpu`, colour from agent-id hash (A-T5) |
| Per-agent "≈ time · $cost" | 3 | 19, 20 | Covered | last 10 runs |
| "Select all" | 3 | 29 | Covered | |
| CTA + "≈ 8.2s · $0.20 · parallel fan-out" | 3 | 20 | Covered | max/sum matches the mockup numbers |
| "Configure run" back button | 4, 5 | 47 | Covered | |
| "N selected agents · parallel" | 4, 5 | 32 | Covered | |
| PR line "#482 title" | 4, 5 | 32 | Covered | |
| Summary "4 agents · fan-out via worktrees · 8.2s total · $0.20" | 4, 5 | 17, 18, 32, 49 | Covered | "worktrees" replaced by "parallel" |
| Columns/Tabs toggle | 4, 5 | 32 | Covered | |
| Column header: name, time, cost, score ring | 4 | 33, 53, 58 | Covered | |
| Finding cards: severity icon, title, file:line | 4 | 33 | Covered | |
| Footer "View trace" + "N findings" | 4 | 33, 36 | Covered | |
| Live per-agent status (not drawn) | 4 | 34, 35 | Covered | |
| "WHERE AGENTS DISAGREE" rows: file:line + title | 4, 5 | 42 | Covered | |
| Cell: agent + SUGGESTION/WARNING + note | 4, 5 | 16, 42 | Covered | note = finding title |
| Cell: "did not flag" + reason | 4, 5 | 42, 54 | Covered | no reason text (decision Q9); mockup reasons are not reproduced |
| "Show only conflicts" toggle | 4, 5 | 43 | Covered | default ON (decision Q5); the mockup draws it OFF |
| Agent tabs with scores | 5 | 37 | Covered | |
| Selected agent header: ring, summary, View trace, time, cost | 5 | 36, 37 | Covered | |
| Expandable finding card: severity, category, file:line, confidence % | 5 | 37 | Covered | |
| Body + SUGGESTED FIX | 5 | 37 | Covered | |
| Accept / Dismiss | 5 | 38 | Covered | |
| Learn | 5 | 40 | Covered | disabled + tooltip, no backend |
| Turn into eval case | 5 | 39 | Covered | decided-finding precondition |
| Reply to author | 5 | 41 | Out of scope | instructor |
| Search bar, top-right icons, repo switcher | 1-5 | none | Out of scope | existing shell |
| PR page body (brief, intent, blast radius) | 1 | none | Out of scope | existing |

**[NEEDS CLARIFICATION] questions**
None. Q13 was decided by the user on 2026-10-23 (see §15).
