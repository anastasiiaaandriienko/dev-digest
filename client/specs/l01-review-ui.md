# Spec: L01 review UI (client)

- **Status:** all six L01 features are implemented (see each "Implemented"
  subsection); the acceptance criteria in §7 describe the verified behaviour. §2
  uses the owner's phase names (Initiation → Completion) instead of the
  Diff / Setup / Context / Review / Grounding names proposed below; the original
  "Context" step is Planning, and it is `skipped` when repo-intel is disabled.
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
  - **Revised by the owner (2026-10-11):** small nonzero amounts keep **at least
    three significant digits**. This replaces the earlier "`< 0.01` → four
    decimals / otherwise two decimals" rule (which gave `0.001 → $0.0010`, two
    significant digits, and `0.4234 → $0.42`):
    - `0 < x < 1` → rounded to 3 significant digits, trailing zeros trimmed down to
      two decimals: `0.001 → $0.001`, `0.001234 → $0.00123`, `0.4234 → $0.423`,
      `0.42 → $0.42`, `0.06 → $0.06`, `0.5 → $0.50`;
    - `x ≥ 1` → two decimals (`$1.23`, `$1,234.50`), which already carry ≥ 3
      significant digits;
  - when `partial` is true → prefix `≥ ` (only on a known figure).
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

### Implemented (2026-10-11)
- **Formatter:** `formatCost(usd, { partial?, unknown? })` in `src/lib/format.ts`,
  used by all three surfaces; tests in `src/lib/format.test.ts`.
- **PR list:** "Cost" column after "Score" (`GRID`, `COLUMN_KEYS`,
  `prReview.list.columns.cost`) in `LIST/_components/PRRow/PRRow.tsx`. The cell's
  `title` explains the figure (`list.costHint` / `costPartialHint` / `costUnknownHint`).
- **Run timeline:** a `run-cost` badge in the right-hand column of each run row;
  `formatCost(cost_usd)` for `done` runs, `—` otherwise (`timeline.cost` /
  `timeline.costUnavailable` as `title`).
- **Trace drawer:** "COST" `Stat` between Tokens and Findings
  (`runs.trace.stat.cost`, unknown → `runs.trace.costUnknown` = `n/a`).
- **Cache refresh** (`src/lib/hooks/reviews.ts`):
  - `useRefreshCostOnRunSettled(prRuns, repoId)` (used by the PR page): when a run
    in `pr-runs` leaves `running` — via the SSE `onRunDone` invalidation or the
    4 s poll — invalidate `["pulls", repoId]` (PR total) and `["run-trace", runId]`.
  - `useDeleteRun(prId, repoId)` also invalidates `["pulls", repoId]`, because
    deleting a run lowers the PR total. Deleting a review does not change the
    total (server spec §4.3), so `useDeleteReview` is unchanged.
- **Tests:** C1 → `src/lib/format.test.ts`; C2 → `LIST/_components/PRRow/PRRow.test.tsx`;
  C3 → `PR/RunHistory/RunHistory.test.tsx`; C4 → `PR/RunTraceDrawer/RunTraceDrawer.test.tsx`;
  cache refresh → `src/lib/hooks/reviews.test.tsx`.

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

### Implemented (2026-10-11, client-side derivation, no contract change)
- **Phases (owner's names) and the real events that drive them**
  (`src/lib/run-phases.ts`, `RULES`):

  | Phase | Events (emitter) | Ends when |
  |---|---|---|
  | 1 Initiation | `Loading PR diff…`/`done`/`failed`, `Failed to load PR diff`, `Diff ready —`, `Starting review with agent`, `Resolving <p> provider…`/`failed` (executor + `RunLogger.step`) | `Resolving <p> provider done (Nms)` |
  | 2 Planning (= the original "Context" step) | `callers digest:`, `repo map:`, `file rank:` (executor, repo-intel context for the prompt) | the first Implementation event; **skipped** on `Repo intel disabled for this agent — skipping context enrichment` |
  | 3 Implementation | the strategy decision `Reviewing N changed file(s) in one pass` / `Large diff → map-reduce over N files`, then `map: reviewing <file>` / `Reviewing all files in one pass`, `<chunk>: N candidate finding(s)` (reviewer-core) | `Reduced to N finding(s)…` |
  | 4 Validation | `grounding dropped "…"` (reviewer-core) | `Citation grounding: k/n passed` |
  | 5 Completion | `Persisted review …` (executor, after the commit) | `Run complete…` |

- **States:** `pending · active · completed · skipped · failed` (+ `cancelled`
  flag on the failed phase). A phase is completed only when a later phase's event
  or its own end event was seen. After an end event the NEXT phase is the one in
  progress or the one that failed, even if it emitted nothing yet.
- **Skipped (explicit evidence only):** the executor's
  `Repo intel disabled for this agent — skipping context enrichment` line marks
  **Planning** `skipped` (it ends Planning; Implementation is next). Silence is
  never read as skipped: repo-intel ON but with nothing to attach logs nothing, so
  Planning shows `completed` once Implementation starts. A skipped phase stays
  `skipped` in `done`, `failed`, `cancelled` and live runs.
- **Truthfulness rules (`phasesFrom(lines, status)`):**
  - the persisted / known status wins: `done` → all completed except an
    explicitly skipped phase (a persisted trace has no Completion lines, by
    design); `running` → an active phase; `failed` / `cancelled` → the phase where
    it stopped is failed and the later ones stay pending;
  - without a status, the log's own terminal lines decide (`Run complete…`,
    `Run cancelled by user`, any `error` line); otherwise the outcome is `unknown`
    and nothing is shown as active;
  - a failed run with no lifecycle event at all (e.g. reaped on restart) shows
    every phase pending plus "failed before it logged any phase": no phase is invented;
  - map-reduce shows "file k of n" from the real `map: reviewing` events.
- **Where:** `PR/PhaseStepper` above the log in `RunStatus` (one stepper per live
  run, labelled with the agent name, from that run's own events) and in the
  `RunTraceDrawer` (the page passes `runStatus` from the run list).
- **Wording guard:** `server/test/run-phases.test.ts` imports this client file
  and runs the REAL executor + reviewer-core (mocked adapters) through success,
  map-reduce, repo-intel with context, repo-intel with nothing to attach
  (Planning completed), repo-intel disabled (Planning skipped), diff failure,
  missing provider key, model failure, cancel and persistence failure. A server
  wording change fails that test.
- **Not done:** the preferred server-side `data.phase` tagging below (it would be a
  contract change).

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

### Implemented (2026-10-11)
- **Chips:** `PR/SeverityChips/SeverityChips.tsx` — an **All** chip (total; active
  when nothing is selected; click = reset) plus one chip per `CRITICAL` / `WARNING`
  / `SUGGESTION` (`INFO` only when present), coloured with the `SEV` tokens,
  `aria-pressed`. Counts come from `countBySeverity` (`src/lib/findings.ts`) over
  ALL of the review's findings. The same component renders read-only (no buttons)
  in the Trace drawer and the log tab.
- **Filter:** multi-select, AND-combined with hide-low-confidence, via
  `visibleFindings(findings, { hideLow, severities })` and `toggleSeverity`
  (`PR/FindingsPanel/helpers.ts`). State is local `useState` (not in the URL).
- **Clear way back:** while filtered, a status line "Showing N of M findings ·
  Show all findings"; the no-match empty state has a "Show all findings" button.
  A review with **zero** findings now shows "No findings" instead of the
  misleading "No findings match".
- **Keyboard:** `j`/`k`/`a`/`d` act on the filtered list; the focus index resets
  on a filter change and is clamped when the list shrinks (an empty list never
  acts).
- **Not changed:** the accordion header text and its blocker number (open decision 4).

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
  *Superseded:* the implementation below keeps the row a plain container (a
  focusable `role="link"` row would nest the FINDINGS button inside a link).
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

### Implemented (2026-10-11, option P1)
- **Semantics (no nested interactive controls):** state lives in
  `useFindingsPopover()` (`LIST/_components/FindingsPopover/FindingsPopover.tsx`),
  driven by `PRRow`.
  - The row is a **plain container** (no role, no tab stop). A **click** anywhere
    on it still navigates (mouse convenience); it ignores clicks on its own links
    and buttons.
  - The **PR title is a real link** (`<a href="/repos/:id/pulls/:n">`): the
    keyboard and screen-reader entry to the PR. A plain click uses client routing;
    Ctrl/⌘/Shift/middle clicks are left to the browser (new tab). The e2e flows'
    `find text "<title>" click` still navigates.
  - The **FINDINGS button** is a regular tab stop next to the title, with
    `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`.
- **Preview (pointer or focus):** hovering the row, or keyboard focus on the title
  link or the FINDINGS button, opens the popover after 250 ms without moving focus.
  Leaving or blurring before that opens and fetches nothing, so sweeping the
  pointer or tabbing past rows makes no requests. While open, the title link has
  `aria-describedby` = the popover. It closes on pointer leave or blur (150 ms
  grace; moving into the popover keeps it open) and on scroll.
- **Activate (keyboard reachable):** clicking the FINDINGS button (or Enter /
  Space on it) opens the popover at once and moves focus into it: to
  "Open findings →", or to the dialog itself (`tabIndex=-1`) while it has no
  control yet (loading, error, not reviewed).
- **Inside the popover:** Tab past the last control, or Shift+Tab before the
  first, closes it and returns focus to the FINDINGS button (the popover is a
  portal at the end of `<body>`, so natural Tab would jump to the page's end).
- **Escape:** closes it. If focus was in the popover or on the FINDINGS button, it
  returns to the button without reopening. During a title-link preview, focus
  stays on the link; after a pointer preview, focus stays where it was.
- **Rendering:** a fixed-position portal (`role="dialog"`, read-only). Clicks
  inside it stop propagation, because React events bubble through portals to the
  row's navigating `onClick`. Keys are deliberately not stopped (that would also
  stop the native event before the window-level Escape listener).
- **Content:** the latest `kind: "review"` (`latestReview`): agent, verdict,
  severity counts (`SeverityBadge`), total, open criticals (CRITICAL and not
  dismissed), the top 3 findings (undismissed first, then severity, then
  confidence) with `file:line`, "+N more", and "Open findings →" (`?tab=findings`).
- **Data and states:** `usePrReviews` is enabled only while the popover is open
  AND `score != null`. Not reviewed → "Not reviewed yet" (no request); loading →
  skeleton (no counts); error → message (no counts); no review row → "No review
  found"; zero findings → a zero-count summary plus "no findings".
- **Server:** no change (P2 not pursued).

### Depends on
- P1: nothing.
- P2: a server spec plus contract changes on both sides (not pursued).

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

### Implemented (2026-10-11)
- **Persistence:** unchanged server routes. Accept → `POST /findings/:id/accept`;
  Reject → `POST /findings/:id/dismiss`. Each sets its timestamp and clears the
  other (`review.repo.ts` `setFindingAccepted` / `setFindingDismissed`). No schema change.
- **Labels:** `prReview.finding.dismiss` = "Reject", the tag `finding.dismissed`
  = "rejected" (also `runs.trace.findingState.dismissed`).
- **`useFindingAction`** (`src/lib/hooks/reviews.ts`), `mutationKey: ["finding-action"]`:
  - optimistic patch of `["reviews", prId]` (card, accordion blocker count, PR-list
    popover and Trace drawer all read it);
  - on error, roll back **only that finding**; the global toast reports it;
  - `onSettled` invalidates `["reviews", prId]`.
- **Per-card state:** `useFindingDecisionStatus()` reads the latest decision per
  finding from the mutation cache (`useMutationState`) → pending (both buttons
  disabled, "Saving decision…"), error (message, buttons usable), success
  ("Decision saved"). The button for the decision a finding already has is
  disabled (`aria-pressed`): no undo in L01.
- **Keyboard:** `a`/`d` skip a pending finding or a no-op decision. Only the
  keyboard-owning panel reacts (`PR/FindingsPanel/keyboard-owner.ts`): the one last
  clicked or focused into, otherwise the first mounted, which fixes the
  two-accordions bug.

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

### Implemented (2026-10-11)
- **Live runs:** the PR page passes `running={liveRunIds.includes(traceRunId)}`,
  so a live run's drawer opens on the Live log tab and streams SSE.
- **Findings section:** read-only `SeverityChips` counts; each finding uses the
  `SEV` tokens (INFO-safe), shows `file:start-end` and an **accepted** /
  **dismissed** tag (dismissed ones are dimmed); findings are sorted by severity.
- **Dropped by grounding:** parsed from the trace log by `droppedFromLog`
  (`PR/RunTraceDrawer/helpers.ts`); a collapsed "Dropped by grounding (N)" list
  with title + reason only.
- **Grounding badge:** `groundingTone` → green when all passed, amber when some
  were dropped, muted for `0/0`, an unreadable value, or a log with an `error` line.
- **Log tab (`_components/LogFindings`):** above the stream, the run's persisted
  severity counts (or "No persisted findings for this run yet"), what the log says
  (`findingsFromLog`: candidates summed over chunks, the count after reduce, the
  number dropped; `null`, not 0, before the engine reported), and an "Only finding
  lines" switch that narrows the log to finding-related lines (`isFindingLogLine`).
  The stream's own filter input still applies. This replaces colour highlighting,
  which would need a change in the vendored `LiveLogStream`.
- **Not done:** the per-finding "Open in review" link.

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
   shows `n/a`. `0.001` renders as `$0.001`, never `$0.00` (revised rule, §1).
4. **Formatter:** one `formatCost` is used by all three surfaces and is covered by
   unit tests (`null`, `0`, `< 0.01`, `0.01 ≤ x < 1`, `≥ 1`, `partial`); every
   nonzero amount below $1 keeps at least three significant digits.
5. **Phases** (Initiation, Planning, Implementation, Validation, Completion; §2):
   - a live run shows 5 steps that advance as events arrive;
   - an `error` event marks the active step failed;
   - a run with repo-intel disabled shows **Planning** (the original "Context"
     step) as skipped — only on the executor's explicit "Repo intel disabled"
     event, never because lines are missing;
   - a persisted trace shows the same steps reconstructed from `trace.log` plus
     the run's status.
6. **Severity filter:**
   - the chip counts equal the number of that severity in the review;
   - toggling a chip filters the list, combined with hide-low-confidence;
   - `j`/`k`/`a`/`d` act on the filtered list;
   - when nothing matches, the existing empty state shows.
7. **Popover:**
   - hovering a reviewed PR row, or keyboard focus on its title link or FINDINGS
     button (after 250 ms), shows the latest review's counts and up to 3 findings;
   - activating the FINDINGS button opens it at once and moves focus inside, so its
     link is keyboard-reachable; Tab / Shift+Tab out of it returns to the button;
   - no interactive control is nested in another (the row is a plain container;
     the title link and the FINDINGS button are siblings);
   - an unreviewed PR shows "Not reviewed yet" without a request, and passing over
     or tabbing past rows makes no request;
   - Escape closes it, restores focus as described in §4, and does not reopen it;
   - clicking the row or its title link still navigates; clicks inside the popover
     and on the FINDINGS button do not.
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
| C1 | `formatCost` helper | `null`, `0`, `0.001`, `0.001234`, `0.4234`, `1.234`, `{ partial: true }` | `—`/`n/a`, `$0.00`, `$0.001`, `$0.00123`, `$0.423`, `$1.23`, `≥ $…` |
| C2 | `PRRow` | `PrMeta` with `cost_usd: 0.42`, `cost_partial: false`, then `null` | shows `$0.42`, then `—` |
| C3 | `RunHistory` | done run with `cost_usd: 0.001`; failed run with `cost_usd: null` | `$0.001` on the done row; `—` on the failed row |
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

Where the implemented scenarios live: S1 → `PR/FindingsPanel/helpers.test.ts`;
S2 → `PR/FindingsPanel/FindingsPanel.test.tsx`; H1/H2 (plus loading, error,
zero findings, Escape, click routing) → `LIST/_components/FindingsPopover/FindingsPopover.test.tsx`;
T1/T2/T3 (plus grounding tones and the log-tab summary) →
`PR/RunTraceDrawer/RunTraceDrawer.test.tsx`, with the log parsers in
`PR/RunTraceDrawer/helpers.test.ts`; shared helpers in `src/lib/findings.test.ts`.
T3 is tested at the drawer level (`running` → `useRunEvents([runId])`); the
page-level `liveRunIds` wiring is not covered by a test. E1 is not implemented.

Phases and decisions: P1–P4 → `src/lib/run-phases.test.ts` (table-driven),
pinned against the real emitters by `server/test/run-phases.test.ts`, with
per-run steppers in `PR/RunStatus/RunStatus.test.tsx` and the drawer cases in
`RunTraceDrawer.test.tsx`. With the owner's phase names:
- **P2** changed: a provider-resolution failure is part of **Initiation**, so the
  result is Initiation failed and 2–5 pending (not "1 done, 2 failed");
- **P3** holds with the new name: "Repo intel disabled for this agent" → Planning
  = `skipped`. A run with repo-intel on but nothing attached shows Planning
  `completed`, because silence is not evidence of a skip.

H1/H2 → `LIST/_components/FindingsPopover/FindingsPopover.test.tsx`:
semantics (plain row, real title link, no nested controls, button with
`aria-haspopup`), title-link and row navigation (single push; modified clicks left
to the browser), hover and focus previews after the delay, no request when
sweeping or tabbing past, `aria-describedby`, activation moving focus inside (or
to the dialog while loading), Tab / Shift+Tab / Escape returning to the button
without reopening, Escape keeping focus on the title link or after a pointer
preview, the grace period when moving into the popover, plus the content states.

A1 → `PR/FindingCard/FindingCard.test.tsx` (plus pending / error / success /
disabled states); A2 (plus no-op and pending keys) → `PR/FindingsPanel/FindingsPanel.test.tsx`;
A3 (rollback of only the failed finding, optimistic update before the server
answers, refetch on settle) → `src/lib/hooks/finding-decisions.test.tsx`; server
persistence and errors → `server/test/finding-decisions.it.test.ts`.

## 9. Open decisions

1. ~~Phase source~~ — decided for L01: message-prefix derivation in the client,
   pinned against the real emitters by `server/test/run-phases.test.ts` (§2). A
   server `data.phase` field remains the better long-term option.
2. ~~Popover data~~ — decided: P1, lazy `usePrReviews` (§4).
3. ~~Whether the severity filter state should live in the URL~~ — decided for
   L01: no, local `useState` per panel (§3).
4. Which "blockers" number to show: the gate-based one or "open criticals".
