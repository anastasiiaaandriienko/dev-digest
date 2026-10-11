# Spec: L01 review UI (client)

- **Status:** proposal; nothing in the "Proposed" sections below is implemented.
- **Verified against source:** 2026-10-11.
- **Server dependency:** cost data follows the chosen **Option B (trace JSONB, no
  migration)** in [../../server/specs/review-run-cost.md](../../server/specs/review-run-cost.md).
  This spec does not repeat how the server stores or aggregates cost.

Each feature has three parts: **Current** (verified behaviour, with file references),
**Proposed** (behaviour to build) and **Depends on** (server or contract work).

Short paths used below:
- `PR/` = `src/app/repos/[repoId]/pulls/[number]/_components/`
- `LIST/` = `src/app/repos/[repoId]/pulls/`

---

## 1. Cost badge

### Current
- **No cost anywhere in the UI.** Commit `d45ab0d` removed the trace "Cost" stat,
  `formatCost` and the `cost_usd` contract fields.
- **What the three surfaces show today:**
  - `RunHistory` rows (`PR/RunHistory/RunHistory.tsx:149-221`): outcome badge,
    score ring, agent name, `provider/model`, findings and blockers, and time.
  - The Trace drawer stats row (`PR/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:63-67`):
    duration, tokens and findings.
  - `PRRow` (`LIST/_components/PRRow/PRRow.tsx`): title, author, size, score,
    status and updated. Its columns come from `GRID` and `COLUMN_KEYS` in `LIST/constants.ts`.

### Proposed
- **One shared formatter.** Put `formatCost(usd, { partial? })` in a single place
  (for example `src/lib/format.ts`) and use it on all three surfaces. Do not
  reintroduce the old `toFixed(2)`: it turned a real cost of $0.001 into "$0.00".
  - `null` or `undefined` → `—` in lists, `n/a` in the trace;
  - `0` → `$0.00` (free models);
  - `< 0.01` → four decimals (`$0.0012`);
  - otherwise → two decimals (`$0.42`);
  - when `partial` is true → prefix `≥ `.
- **PR list.** Add a "Cost" column after "Score": update `GRID`, `COLUMN_KEYS` and
  `prReview.list.columns.cost`.
  - The value is `PrMeta.cost_usd`, the total over **successful** runs, plus
    `PrMeta.cost_partial`.
  - A tooltip explains "Total of successful runs; estimates for OpenAI/Anthropic".
- **Run timeline.** Add a cost badge in the right-hand column of each run row
  (`RunHistory.tsx:198-200`, next to the time), only when `status === "done"`.
  Otherwise show `—`.
- **Trace drawer.** Add a "Cost" `Stat` between Tokens and Findings, from
  `trace.stats.cost_usd`. A missing key (an old trace) shows as `n/a`.
- **Strings.** Add new keys under `prReview` (list and timeline) and `runs` (`trace.stat.cost`).

### Depends on
- The server fields `PrMeta.cost_usd` / `cost_partial`, `RunSummary.cost_usd` and
  `RunStats.cost_usd`, as defined in the server spec.
- The client copy of `src/vendor/shared/contracts/{platform,trace}.ts` must receive
  the **same** field definitions.

---

## 2. Five execution phases

### Current
- **There is no phase concept in the code.** A run is shown as a flat stream of
  `RunEvent { seq, kind: info|tool|result|error, msg, t, data? }` lines in
  `LiveLogStream`, rendered by `PR/RunStatus` (live) and by the drawer's Live log
  tab (persisted).
- **Messages in emission order.** The emitters are `server/src/modules/reviews/run-executor.ts`
  and `reviewer-core/src/review/run.ts`.

| Order | Message text (abridged) | Emitter |
|---|---|---|
| 1 | `Loading PR diff…` / `… done (Nms)`, `Diff ready — N changed file(s)…` | run-executor (fanned out to every queued run) |
| 2 | `Starting review with agent "…"`, `Resolving <provider> provider…` / `done` | run-executor |
| 3 | `callers digest: …`, `repo map: …`, `file rank: …`, or `Repo intel disabled for this agent…` | run-executor (best-effort) |
| 4 | `Reviewing N changed file(s) in one pass` / `map: reviewing <file>`, `<label>: N candidate finding(s)`, `Reduced to N finding(s)…` | reviewer-core |
| 5 | `grounding dropped "<title>": <reason>`, `Citation grounding: x/y passed`, `Persisted review …`, `Run complete; trace persisted` | reviewer-core + run-executor |

- **Data on events.** Live events may carry `data`, but nothing sets a phase on it.
- **Persisted logs.** `RunLogLine` keeps only `{ t, kind, msg }`, so even that `data` is lost on save.

### Proposed
- **A phase stepper above the log**, for both live runs and the drawer:
  1. **Diff**
  2. **Setup** (provider)
  3. **Context** (repo-intel)
  4. **Review** (model)
  5. **Grounding & save**
- **Step states:** `pending · active · done · skipped · failed`.
  - **Context** shows as `skipped` when the agent has repo-intel disabled, or when
    no callers, repo map or file rank were attached.
  - An `error` event marks the active step `failed`.
  - A cancelled run marks the active step `failed`, labelled "cancelled".
- **Map-reduce runs.** During the Review step, show a "file k of n" counter taken
  from the `map: reviewing` events.
- **Where the logic lives.** Build it as a pure `phaseOf(event)` /
  `phasesFrom(events)` helper (`helpers.ts`) with table-driven tests. A
  `PhaseStepper` component renders the result; the log stays below it, unchanged.

### Depends on
- **Preferred:** the server tags events with `data.phase` (1–5) and adds
  `phase?: number` to the persisted `RunLogLine`. That is a contract change on both
  sides plus an executor change, and is **not yet specified on the server**. Raise
  it with the server owner.
- **Fallback, client only:** derive the phase from message prefixes (table above).
  This is fragile, because any wording change on the server breaks it silently.
  Acceptable for L01 only if it is covered by the tests in §8.

---

## 3. Severity counts and interactive filters

### Current
- **Sorting and the only filter.** `FindingsPanel` sorts by `SEVERITY_ORDER`
  (`PR/FindingsPanel/constants.ts:4`), and its one filter is "hide low confidence"
  (< 0.65, `helpers.ts:5`).
- **Counts on screen:**
  - The `ReviewRunAccordion` header shows the total and "blockers", where a blocker
    is a `CRITICAL` finding that is **not dismissed** (`ReviewRunAccordion.tsx:56`).
  - The timeline shows the server's `blockers` count, which comes from the agent's
    gate and **ignores dismissals**. The two numbers can therefore disagree.
  - There are no per-severity counts anywhere.
- **Leftovers from a removed filter:** the unused `s.divider` style and the
  "Adjust the filters above" text in `prReview.panel.noMatchBody`.

### Proposed
- **Severity chips.** Add one chip per severity (`CRITICAL`, `WARNING`, `SUGGESTION`)
  to the `FindingsPanel` toolbar.
  - Each chip shows a count over **all** of that review's findings, ignoring other
    filters, so the numbers stay stable while toggling.
  - Use `SEV` tokens or `SeverityBadge` for colours.
  - Add an `INFO` chip only when such findings exist (the UI tokens support `INFO`;
    the contract does not).
- **Multi-select toggle.** No chip selected means all severities.
  - The chip filter combines with "hide low confidence" using AND.
  - Extend `visibleFindings(findings, { hideLow, severities })` as a pure helper.
- **Keyboard.** `j`/`k` and `a`/`d` act on the **filtered** list, and the focus
  index is clamped whenever the filter changes.
- **Empty state.** When nothing matches, show the existing `noMatch*` texts.
- **Scope.** Filter state is local to each panel (`useState`). Keeping it in the
  URL (`?sev=`) is an open question; this proposal does not do it.
- **Blocker definition.** Decide which one to show. Recommendation: label the
  accordion number "open criticals", so it is not mistaken for the gate-based blockers.

### Depends on
Nothing on the server.

---

## 4. Findings hover popover in the PR list

### Current
- **No popover.** `PRRow` shows only a score ring.
- **What `PrMeta` provides.** Only `score`. The server deliberately leaves out the
  per-severity breakdown of the list endpoint (comment in `server/src/modules/pulls/routes.ts:114-117`).
- **Row interaction.** Rows are `div`s with `onClick`. They have no keyboard focus
  or role, so hover is the only way to trigger anything.

### Proposed
- **Trigger.** A popover anchored to the score cell opens after a 250 ms hover, or
  on keyboard focus once the row becomes focusable (`tabIndex=0`, `role="link"`,
  Enter to open). It closes on mouse leave or Escape. Clicks still navigate.
- **Content:**
  - severity counts and the blockers count of the **latest review**;
  - its verdict;
  - up to 3 top findings, as severity + title + `file:line`;
  - a link: "Open findings →" (`?tab=findings`).
- **Data, option P1 (recommended for L01, no server change).** Load the popover on
  hover with `usePrReviews(pr.id)`.
  - It is cached under `["reviews", prId]` and reused by the PR detail page.
  - Only one request is made per hovered PR.
  - Don't fetch for PRs that have never been reviewed (`score == null`); show
    "Not reviewed yet" instead.
  - Show a `Skeleton` while loading.
- **Data, option P2.** The server adds a `findings_summary` to `PrMeta`. This is
  faster, but it is a contract and server change that is not specified yet.

### Depends on
- P1: nothing.
- P2: a server spec plus contract changes on both sides. **Decision needed.**

---

## 5. Accept / Reject actions

### Current
- **Two actions.** `FindingCard` has **Accept** and **Dismiss** buttons
  (`PR/FindingCard/FindingCard.tsx:92-111`), and `FindingsPanel` maps keyboard
  `a` and `d` to them.
- **Request.** `useFindingAction` posts `/findings/:id/(accept|dismiss)` and
  invalidates `["reviews", prId]` on success.
- **Server behaviour.**
  - The two states exclude each other: setting one clears the other
    (`server/src/modules/reviews/repository/review.repo.ts:119-143`).
  - There is **no way to undo**, because the route always sets a timestamp.
  - `learn` and `reply` exist in `FindingActionKind` but return 400.
- **Display.**
  - A decided finding is muted and tagged accepted or dismissed.
  - One `isPending` flag disables the buttons of **every** card in the panel.
  - There is no optimistic update.
- **[potential bug]** Each mounted `FindingsPanel` adds its own `window` keydown
  listener (`FindingsPanel.tsx:34-46`). With two review accordions open, a single
  `a` or `d` press acts on the focused finding in **each** of them.

### Proposed
- **"Reject" is a label, not a new action.** Rename the **Dismiss** label to
  **Reject** in `prReview.finding.dismiss`. It maps to the existing `dismiss`, so
  no API change is needed.
- **Optimistic update.** Set `accepted_at` / `dismissed_at` in the
  `["reviews", prId]` cache on mutate, and roll back on error. The global toast
  already reports the failure.
- **Pending state.** Track it per card (by `findingId`) rather than per panel.
- **Keyboard.** Only the panel the user is working in responds to `a`, `d`, `j`
  and `k`: the panel that contains focus, or the last one clicked. This fixes the
  listener bug above.
- **Blocker count.** After an action, the accordion's blocker count updates (it
  already derives from `dismissed_at`).
- **Out of L01: undo** (clicking an active button to clear it). It needs a server
  endpoint that sets `null`.

### Depends on
Nothing for the label, the optimistic update or the keyboard scoping. Undo needs
server work.

---

## 6. Findings in the Trace drawer and logs

### Current
- **Findings section.** `TraceBody` renders `FindingsSection`
  (`PR/RunTraceDrawer/_components/FindingsSection/FindingsSection.tsx`).
  - It lists the run's **persisted (kept)** findings. The page passes them by
    matching `review.run_id === traceRunId` (`[number]/page.tsx:178`).
  - It shows severity, title, `file:start-end`, rationale and suggestion.
  - It does **not** show the accepted or dismissed state.
  - Its own `SEV_COLOR` map has no `INFO`.
- **Grounding badge.** It is always green with a check icon, even for `0/0 passed`
  or a run that failed (`TraceBody.tsx:57-61`).
- **Logs.** Findings reach the log only as counts (`N candidate finding(s)`,
  `Reduced to N`) and as one line per dropped finding:
  `grounding dropped "<title>": <reason>`. Persisted traces keep these lines.
- **[potential bug]** The page never passes `running` to `RunTraceDrawer`
  (`[number]/page.tsx:175-181`). As a result:
  - Opening the trace of a **live** run ("Open run trace" in `FindingsTab`) does
    not stream SSE.
  - It requests a trace that does not exist yet (404, `retry: false`), shows
    "no trace", and leaves the Live log tab empty until the drawer is reopened
    after the run finishes.

### Proposed
- **Live runs.** Pass `running={liveRunIds.includes(traceRunId)}` so a live run
  opens on the Live log tab with SSE and the phase stepper (§2). Once the run is
  done, the drawer switches to the persisted trace.
- **Findings section header.** Show severity counts (the same chips as §3, read-only).
- **Each finding:**
  - shows its accepted or rejected state;
  - uses shared `SEV` tokens;
  - has an "Open in review" link that closes the drawer and scrolls to the card,
    reusing the `onGoToReview` mechanism.
- **"Dropped by grounding" sub-list.** Parse the `grounding dropped` log lines into
  title + reason, collapsed by default.
  - This is limited to what the log carries: no file or line.
  - If the server later adds the dropped findings to the trace, use that instead.
- **Grounding badge colour:** green when all passed; amber when some were dropped;
  muted when `0/0` or the run failed.
- **Log filtering.** In the Live log tab, finding-related lines (`candidate`,
  `Reduced`, `grounding`) are highlighted. They stay searchable with the existing
  `LiveLogStream` filter input.

### Depends on
Nothing for the above. Structured dropped findings would need a server and trace
contract change, which is out of L01 scope.

---

## 7. Acceptance criteria

1. **Cost, PR list:**
   - each row shows a cost cell from `PrMeta.cost_usd`;
   - `null` → `—`;
   - `cost_partial` → `≥ $x`;
   - the column header comes from i18n.
2. **Cost, timeline:** `done` runs show the formatted `RunSummary.cost_usd`.
   Running, failed and cancelled runs, and `null` values, show `—`.
3. **Cost, Trace drawer:** the stats row shows Cost. An old trace without the key
   shows `n/a`. `0.001` renders as `$0.0010`, never `$0.00`.
4. **Formatter:** one `formatCost` is used by all three surfaces and is covered by
   unit tests (`null`, `0`, `< 0.01`, `≥ 0.01`, `partial`).
5. **Phases:**
   - a live run shows 5 steps that advance as events arrive;
   - an `error` event marks the active step failed;
   - a run with repo-intel disabled shows Context as skipped;
   - a persisted trace shows the same steps reconstructed from `trace.log`.
6. **Severity filter:**
   - the chip counts equal the number of that severity in the review;
   - toggling a chip filters the list, combined with hide-low-confidence;
   - `j`/`k`/`a`/`d` act on the filtered list;
   - when nothing matches, the existing empty state shows.
7. **Popover:**
   - hovering or focusing a reviewed PR row shows the latest review's counts and
     up to 3 findings;
   - an unreviewed PR shows "Not reviewed yet" without a request;
   - Escape closes it;
   - clicking the row still navigates.
8. **Accept / Reject:**
   - the buttons read Accept / Reject;
   - an action updates the card at once (optimistic) and survives a refetch;
   - a failure rolls back and shows a toast;
   - with two accordions open, one key press changes exactly one finding.
9. **Trace findings:**
   - the drawer lists the run's findings with their accept/reject state;
   - dropped-by-grounding titles and reasons appear;
   - the grounding badge colour follows the rule in §6;
   - opening the trace of a live run streams the log.
10. **No regressions.** `pnpm typecheck` and `pnpm test` pass. Every new string is in
    `messages/en/*.json`. The client and server `vendor/shared` copies gain identical
    new fields (`diff -rq` shows no new differences).

## 8. Test scenarios

Unless noted otherwise, these are co-located component or helper tests that mock
hooks as described in [../docs/testing.md](../docs/testing.md).

| # | Target | Scenario | Expectation |
|---|---|---|---|
| C1 | `formatCost` helper | `null`, `0`, `0.001`, `0.4234`, `{ partial: true }` | `—`/`n/a`, `$0.00`, `$0.0010`, `$0.42`, `≥ $…` |
| C2 | `PRRow` | `PrMeta` with `cost_usd: 0.42`, `cost_partial: false`, then `null` | shows `$0.42`, then `—` |
| C3 | `RunHistory` | done run with `cost_usd: 0.001`; failed run with `cost_usd: null` | `$0.0010` on the done row; `—` on the failed row |
| C4 | `RunTraceDrawer` | fixture `stats.cost_usd: 0.06`; fixture without the key | "Cost $0.06"; "Cost n/a" |
| P1 | `phasesFrom` helper | event list for a full single-pass run | 5 × `done` |
| P2 | `phasesFrom` | events stop after `Resolving openai provider…` plus an `error` | steps 1 done, 2 failed, 3–5 pending |
| P3 | `phasesFrom` | `Repo intel disabled for this agent` | Context = skipped |
| P4 | `phasesFrom` | map-reduce events for 3 files, currently on the 2nd | Review active, "2 of 3" |
| S1 | `visibleFindings` | severities `{CRITICAL}` with hideLow on and off | only criticals; low confidence ones removed when on |
| S2 | `FindingsPanel` | 2 CRITICAL + 1 WARNING; click the WARNING chip | chip counts 2/1/0; one card visible; `j` stays in range |
| H1 | `PRRow` popover | hover a reviewed row with mocked `usePrReviews` | counts + top findings + link; Escape closes |
| H2 | `PRRow` popover | `score == null` | "Not reviewed yet"; `usePrReviews` not enabled |
| A1 | `FindingCard` | labels | "Accept" / "Reject" from i18n |
| A2 | `FindingsPanel` | two panels mounted, press `a` | `mutate` called once |
| A3 | `FindingsPanel` | mutation fails (mocked) | card returns to its previous state |
| T1 | `FindingsSection` | an accepted and a dismissed finding | state tags rendered |
| T2 | `TraceBody` | log with two `grounding dropped` lines; grounding `1/3 passed` | 2 dropped items; amber badge |
| T3 | PR detail page / `RunTraceDrawer` | open the trace of a run listed in `liveRunIds` | `useRunEvents` called with `[runId]`; Live log tab active |
| E1 | e2e (`e2e/specs`) | seeded PR → findings tab → filter chips → Reject | card muted after reload (server-persisted) |

## 9. Open decisions

1. Phase source: a server `data.phase` field (preferred; needs a contract change)
   or message-prefix parsing.
2. Popover data: P1, lazy `usePrReviews` (recommended), or P2, a server summary.
3. Whether the severity filter state should live in the URL.
4. Which "blockers" number to show: the gate-based one or "open criticals".
