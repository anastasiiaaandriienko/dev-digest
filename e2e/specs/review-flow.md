# Spec: PR review flow (e2e)

- **Status:** §1–§2 describe **existing** coverage, verified on 2026-10-11.
  §3–§5 list **proposed** flows; none of them exists yet.
- **Detailed UI behaviour:** see [../../client/specs/l01-review-ui.md](../../client/specs/l01-review-ui.md).
- **Cost storage:** see [../../server/specs/review-run-cost.md](../../server/specs/review-run-cost.md) (Option B).

## 1. The review flow as a user sees it (current product)

1. `/` redirects to the first repo's PR list, `/repos/<id>/pulls`. The default filter is `?status=needs_review`.
2. Clicking a PR row opens `/repos/<id>/pulls/<number>`; tabs are switched with `?tab=`.
3. **Run Review ▾** sends `POST /pulls/:id/review`. The server answers with run
   ids straight away and reviews in the background.
4. The **Agent runs** tab (`?tab=findings`) shows, from top to bottom:
   - "Live review": the SSE log for in-flight runs;
   - "Review in progress…";
   - the **Timeline** of runs and commits;
   - the **Review runs** accordions (verdict, counts, score, findings).
5. When the run finishes, the SSE stream closes. The page then invalidates the run
   lists and refetches reviews, and the timeline row shows its outcome badge.
6. `?trace=<runId>` opens the Trace drawer, with a Trace tab and a Live log tab.
7. A finding is accepted or dismissed by clicking its button, or with the `a`/`d` keys.

## 2. Existing e2e coverage

These are seeded, read-only checks; no review is executed.

| Step in §1 | Covered by | Assertion |
|---|---|---|
| 1 | `specs/01-app-boot.flow.json`, `02-…` | URL `/pulls`; "Pull Requests"; seeded PR title |
| 2 | `02-repo-pulls-detail` | click the title, then URL `/pulls/482` and the title on the detail page |
| 4, persisted review only | `04-pr-findings` | "Agent runs" tab → URL `tab=findings`; text "request changes", "2 findings", "Hardcoded Stripe secret key in commit" |
| diff tab | `05-pr-diff` | "Files changed" → `tab=diff`; "src/config.ts" |
| 3, 5, 6, 7 | **none** | — |

**Why steps 3, 5, 6 and 7 are not covered:**
- A run would need an LLM key.
- The seeded PR has no diff patches and no clone.
- The server has no deterministic LLM mode.
- The seed has no `agent_runs` or `run_traces` rows.
- Accept and Dismiss write to the DB, and every flow shares one seeded DB and one
  browser session.

**Copy the existing flows depend on.** Keep it stable, or update the flows in the same change:

| Text the flows match | Comes from |
|---|---|
| "Agent runs", "Files changed" | `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx` (hard-coded tab labels) |
| "request changes" | `ReviewRunAccordion.tsx`, built as `verdict.replace("_", " ")` |
| "2 findings" | `ReviewRunAccordion.tsx` (hard-coded English plural) |
| PR title, finding title, `src/config.ts` | `server/src/db/seed.ts` |

## 3. What a review-execution flow must assert [proposed]

These are the assertions an e2e flow should make once a deterministic way to run
a review exists (see §4).

| Phase | Assertion (visible text / URL only) |
|---|---|
| Start | after clicking Run Review → an agent, the URL has `tab=findings`; "Live review" and "Review in progress…" appear |
| Progress | the Live log shows the diff step ("Loading PR diff"), then the model step ("Reviewing … in one pass"), then "Citation grounding:" |
| Completion | "Review in progress…" disappears; the timeline row shows an outcome badge (approved, reviewed or rejected) and the finding count |
| Findings | a new Review runs accordion appears with the agent's name; the grounded finding title is visible; a finding the fixture placed off the diff is **absent** (grounding) |
| Trace | clicking the run's trace icon shows a URL with `trace=`; the drawer shows the Stats section with the grounding summary |
| Failure path | with the provider key missing, the timeline row shows the error badge and the error text |

## 4. Prerequisites for executing a review in e2e [proposed — needs a decision]

The suite needs at least one of these. Each changes another package, which needs
the owner's approval.

| Option | What changes | Trade-off |
|---|---|---|
| **E1. Seeded run history** | Extend the seed with an `agent_runs` row (status `done`, tokens, score, blockers) and a `run_traces` document (with `stats.cost_usd`) linked to the seeded review's `run_id` | Read-only and deterministic; covers the timeline, the Trace drawer and cost. Does **not** cover live progress or SSE. |
| **E2. Deterministic LLM for the e2e stack** | The server picks a fixture provider when a test-only env var is set; the seed adds `pr_files.patch` for PR #482 | Covers the whole run, SSE and grounding; adds a test-only code path in the server |
| **E3. Separate secrets path for the hermetic stack** | `e2e.sh` points the API at an isolated secrets file | Stops the real keys on the developer's machine from being used; needed for E2 to be safe |

**Recommendation:** do E1 for L01, because it is enough for the cost-badge
assertions. Do E2 and E3 together later.

## 5. L01 UI changes: proposed flows

Unless stated otherwise, every flow below is read-only and starts from `open {BASE}/`.

| # | Flow (file) | Needs | Steps / assertions |
|---|---|---|---|
| F1 | `08-pr-list-cost` | E1 + server Option B | on the PR list, the "Cost" column header is visible; the PR #482 row shows the formatted seeded total (e.g. `$0.0123`) |
| F2 | `09-run-timeline-cost` | E1 | PR #482 → Agent runs; the timeline row shows the run's outcome badge and the formatted cost |
| F3 | `10-trace-drawer` | E1 | click the run's trace icon → URL `trace=`; text "Cost" and the formatted value; the drawer's Findings section lists "Hardcoded Stripe secret key in commit" |
| F4 | `11-severity-filter` | the client feature only | Agent runs → the severity chips show "1" (critical) and "1" (warning); click the WARNING chip → "N+1 query in user list endpoint" is visible and the Stripe finding is gone (`wait --text` the visible one, then `find text … ` must fail; see the note below) |
| F5 | `12-findings-popover` | the client feature (P1) | hover the PR #482 row's score (`find text "#482" hover`) → the popover shows "Hardcoded Stripe secret key in commit" and "Open findings" |
| F6 | `13-execution-phases` | E1 (trace log seeded) | open the trace → Live log tab → the five phase labels are visible with the `done` state |
| F7 | `14-accept-reject` | E1, plus run **last** or on its own seed | expand a finding → click "Reject" → the "dismissed" tag is visible; `open` again → still dismissed (persisted) |

**Notes:**
- **Unverified commands.** The existing specs use only the `open`, `wait`,
  `find … click`, `screenshot` and `close` commands. The `hover` and `get text`
  steps proposed above are **[assumption]**: check that the installed agent-browser
  version supports them before writing F4 and F5.
- **Absence checks.** The runner can only assert that something is *present*
  (non-zero exit = fail). An absence assertion needs either an
  `assert.stdoutIncludes` on a `get text` command, or a small runner extension
  (`"expectFail": true`). The runner extension is a proposed change to `run.ts`
  and `lib/assert.ts`.
- **F7 mutates the DB.** It must be the last flow, so that F4 and F5 see the
  original state, or it must run in a separate hermetic run.
- **Copy.** Prefer i18n-backed labels for new UI, so flows match
  `messages/en/*.json`. Hard-coded strings make flows break silently when the copy changes.

## 6. Acceptance criteria

1. Flows 01–07 still pass on a fresh hermetic run after the L01 changes; any copy
   change is reflected in the flows.
2. Every new flow is deterministic: no `chat` command, no LLM call, no network
   beyond localhost. It passes on a run from zero and on a repeated run.
3. Each new L01 surface (PR-list cost, timeline cost, trace cost, severity filter,
   popover, phases, reject) is covered by at least one flow that asserts its
   **visible** output, or is explicitly listed as uncovered with a reason.
4. Flows that change data run after every read-only flow, or are isolated.
5. Seed changes (E1) and server changes (E2, E3) are approved and documented in
   their packages; the e2e docs are updated in the same change.
6. `npm run typecheck` passes in `e2e/`. CI (`e2e-web.yml`) passes, and on failure
   uploads screenshots.

## 7. Test scenarios summary

| # | Scenario | Type | Status |
|---|---|---|---|
| S1 | Boot → PR list → PR #482 detail | read-only | **existing** (01, 02) |
| S2 | Persisted review: verdict, count, finding card | read-only | **existing** (04) |
| S3 | Diff tab renders a seeded file | read-only | **existing** (05) |
| S4 | Cost on the PR list, timeline and trace | read-only | proposed (F1–F3, needs E1) |
| S5 | Severity chips filter the list | read-only | proposed (F4) |
| S6 | Hover popover on the PR list | read-only | proposed (F5) |
| S7 | Five phases in a persisted trace log | read-only | proposed (F6, needs E1) |
| S8 | Reject persists across reload | mutating | proposed (F7) |
| S9 | Live review: start → SSE progress → completion → findings | mutating | proposed (needs E2 + E3) |
| S10 | Failed run shows the error on the timeline | mutating | proposed (needs E2 or a missing key in an isolated secrets file) |
