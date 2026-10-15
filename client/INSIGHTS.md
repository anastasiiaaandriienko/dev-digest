# client — Engineering Insights

Verified, non-obvious knowledge for `client/`. Append-only; maintained via the `engineering-insights` skill.

### 2026-10-11 — Popovers inside clickable PR rows: stop portal clicks, and don't let Escape's focus-return reopen
- **Category:** What Doesn't Work
- **Status:** verified
- **Discovery:** PR list rows are `div`s that navigate in `onClick`. A popover rendered with `createPortal(…, document.body)` still bubbles React events to the row, because React events follow the component tree, not the DOM tree. So the popover's container must call `stopPropagation`. Separately, an indicator that opens on `onFocus` reopens immediately when Escape returns focus to it. A failing test caught this; the fix is a ref that skips the focus-open during the focus return.
- **Evidence:** `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx:26` (row `onClick` → `router.push`); `client/src/app/repos/[repoId]/pulls/_components/FindingsPopover/FindingsPopover.tsx:122` (`createPortal`), `:132` (`stopPropagation` on the portal root), `:80` / `:106` (`skipFocusOpen`). Before the fix, the "Escape closes the popover" test in `FindingsPopover.test.tsx` failed with the dialog still in the document.
- **Guidance:** For any hover/focus overlay inside a clickable row: stop propagation on the trigger and on the portal root, open on focus but guard programmatic `focus()` calls, and test both "row click navigates" and "popover click does not".

### 2026-10-11 — Vitest here is 2.1: `toHaveBeenCalledExactlyOnceWith` does not exist
- **Category:** Tool & Library Notes
- **Status:** verified
- **Discovery:** The client pins Vitest `^2.1.8`, whose `expect` has no `toHaveBeenCalledExactlyOnceWith` (added in later Vitest). Using it fails at runtime with `Invalid Chai property`, not at typecheck.
- **Evidence:** `client/package.json:38` (`"vitest": "^2.1.8"`); `pnpm exec vitest run …/FindingsPopover` → `Error: Invalid Chai property: toHaveBeenCalledExactlyOnceWith`; replaced with `toHaveBeenCalledTimes(1)` + `toHaveBeenCalledWith` (`FindingsPopover.test.tsx:222`).
- **Guidance:** Use `toHaveBeenCalledTimes(n)` together with `toHaveBeenCalledWith(...)`. Check the installed Vitest version before using newer matchers.

### 2026-10-11 — UI parsing server log text must be pinned by a server test that imports the client parser
- **Category:** Codebase Patterns
- **Status:** verified
- **Discovery:** Lifecycle phases are derived on the client from run-event message text, because the events carry no phase field. A server wording change would silently break the UI. The parser is kept pure and import-free, so `server/` Vitest can import it directly across packages and run the REAL executor + reviewer-core (mocked adapters) through it. Also: a persisted trace never contains the post-commit Completion lines (server D1), so "done" must come from `agent_runs.status`, never from the persisted log.
- **Evidence:** `client/src/lib/run-phases.ts:51` (`RULES`), `:106` (`phasesFrom`); `server/test/run-phases.test.ts:19` — `import { phasesFrom } from '../../client/src/lib/run-phases.js'`; `pnpm exec vitest run test/run-phases.test.ts` (server) → 8/8 pass. The same cross-package direction already exists: `reviewer-core/test/run.test.ts` imports `server/src/adapters/mocks.js`.
- **Guidance:** When the UI must interpret server text, keep the interpreter dependency-free and add a server-side test that feeds it real emitter output. Prefer a structured field (`data.phase`) when a contract change is acceptable.
- **Cross-package:** `server/` (executor messages, `RunLogger.step` wording), `reviewer-core/` (`review/run.ts` messages).

### 2026-10-11 — TanStack Query v5: `mutationFn` runs only after an async `onMutate` resolves
- **Category:** Tool & Library Notes
- **Status:** verified
- **Discovery:** With an optimistic `onMutate` that `await`s `qc.cancelQueries`, the HTTP call in `mutationFn` has NOT happened when `mutate()` returns. Asserting on the request synchronously after `act(() => mutate(...))` fails. The cache patch also lands asynchronously.
- **Evidence:** `client/src/lib/hooks/reviews.ts:222-226` (`onMutate` → `await qc.cancelQueries`); a probe test asserting `expect(post).toHaveBeenCalled()` right after `mutate` failed ("expected spy to be called at least once"); the fixed test waits: `client/src/lib/hooks/finding-decisions.test.tsx:97` (`await waitFor(() => expect(post)…)`).
- **Guidance:** In hook tests, `await waitFor(...)` for both the optimistic cache change and the request. Use per-mutation `mutationKey` + `useMutationState` for per-item pending / error state instead of the single `isPending` flag.

### 2026-10-11 — `borderColor` is itself a shorthand: FindingCard still triggers React's shorthand/longhand warning
- **Category:** Recurring Errors & Fixes
- **Status:** verified
- **Discovery:** The FindingCard style comment says it is "All-longhand", but `borderColor` is a shorthand for the four side colours. When `focused` toggles, `borderColor` changes while `borderLeftColor` is set, so React logs "Updating a style property during rerender (borderColor) when a conflicting property is set (borderLeftColor)" and Next's dev overlay shows "1 Issue". Severity filtering triggers it reliably because each filter change moves the focus to a new card. jsdom tests do not catch this.
- **Evidence:** `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/styles.ts:10` (`borderColor: focused ? …`) and `:13` (`borderLeftColor`); the same lines are on `main`. In Chrome on PR #482, clicking All → Warning logged that console error twice (21:46:41, 21:46:55).
- **Guidance:** Never combine `borderColor` with `borderLeftColor` in a style that changes between renders. Set `borderTopColor` / `borderRightColor` / `borderBottomColor` / `borderLeftColor` separately. This fix has not been applied or verified yet. Check the browser console during manual or e2e runs, because unit tests miss this warning.

### 2026-10-11 — Opening `/` silently syncs GitHub PRs: the home page redirects to the first repo's PR list
- **Category:** Codebase Patterns
- **Status:** verified
- **Discovery:** With at least one repo, `client/src/app/page.tsx` `router.replace`s to `/repos/<first>/pulls`. That page calls `GET /repos/:id/pulls`, which syncs PRs from GitHub and persists them when a token is configured. So "just open the app" already writes to Postgres, and a manual or e2e test cannot open the UI without that sync.
- **Evidence:** `client/src/app/page.tsx:17` (`router.replace(\`/repos/${repos[0]!.id}/pulls\`)`); `server/src/modules/pulls/routes.ts:42` (local-first sync comment in the `GET /repos/:id/pulls` handler). In Chrome, navigating to `http://localhost:3000` landed on `/repos/cad150ca-…/pulls`, and the Network tab showed `GET :3001/repos/…/pulls` 200.
- **Guidance:** Treat any visit to `/` as "sync GitHub PRs". For a read-only check, use the API directly or a hermetic stack (e2e uses mock GitHub), and tell the person beforehand when the DB must not change.
- **Cross-package:** `server/` (sync in the pulls route), `e2e/` (flows that open `/`).
