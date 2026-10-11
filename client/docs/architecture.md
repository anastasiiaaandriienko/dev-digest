# Client architecture

Verified against `client/src` on 2026-10-11. The route map diagram and stack
summary are in [../README.md](../README.md) and are not repeated here.

## 1. Routing (App Router)

| Route | File | Notes |
|---|---|---|
| `/` | `src/app/page.tsx` | redirects to the first repo's PR list, or shows an empty state that links to `/onboarding` |
| `/onboarding` | `src/app/onboarding/page.tsx` | add a repo (`AddRepoView`) |
| `/repos/[repoId]/pulls` | `src/app/repos/[repoId]/pulls/page.tsx` | PR list; `?status=` filter (defaults to `needs_review`); search and sort in local state |
| `/repos/[repoId]/pulls/[number]` | `src/app/repos/[repoId]/pulls/[number]/page.tsx` | PR detail; `?tab=overview\|findings\|diff`; `?trace=<runId>` opens the trace drawer |
| `/agents`, `/agents/[id]` | `src/app/agents/**` | agent list and editor |
| `/settings/[section]` | `src/app/settings/[section]/page.tsx` | thin entry that renders `SettingsView` |

- **No other routes.** There are no routes for skills, eval or a dashboard yet,
  and the sidebar `NAV` (`src/vendor/ui/nav.ts`) lists only Pull Requests and
  Agents. The `/showcase` route that `src/vendor/ui/README.md` mentions does not
  exist; the `Gallery` component is only mounted by `src/test/smoke.test.tsx`.
- **Number → uuid.** The PR detail URL carries the PR **number**, but every PR
  API takes the row **uuid**. The page resolves it from the cached pulls list
  (`[number]/page.tsx:35-36`) before any detail query runs.
- **Layout.** `src/app/layout.tsx` (a server component) loads messages and wraps
  the app in `NextIntlClientProvider`, then `<Suspense>`, then `Providers`.

## 2. Data fetching

```
component → useXxx() (src/lib/hooks/*.ts) → api.get/post/… (src/lib/api.ts) → fetch(API_BASE + path)
```

- **`apiFetch`** (`src/lib/api.ts:21`):
  - It sets `content-type: application/json` only when a body is sent, so
    body-less POSTs work with Fastify.
  - A network failure throws `ApiError(status 0, "network_error")`.
  - A non-2xx response reads the server's `{ error: { code, message, details } }`
    envelope and throws `ApiError(status, code)`.
  - A 204 response returns `undefined`.
  - Responses are **cast**, not validated with Zod.
- **Global defaults** (`src/lib/providers.tsx`):
  - `retry: 1`, `staleTime: 30s`, `refetchOnWindowFocus: false`.
  - A failed mutation always shows a toast.
  - A failed query shows a toast only for status 0 or ≥ 500; expected 4xx
    responses are handled inline.

### Query keys (current)

| Key | Hook | File | Refresh |
|---|---|---|---|
| `["repos"]` | `useRepos` | `hooks/core.ts` | invalidated by add/refresh/delete repo |
| `["pulls", repoId]` | `usePulls` | `hooks/core.ts` | `refetchInterval: 60_000`; invalidated by `useRefreshRepo` |
| `["pull", prId]` | `usePullDetail` | `hooks/core.ts` | — |
| `["reviews", prId]` | `usePrReviews` | `hooks/reviews.ts` | invalidated by run/finding-action/delete mutations |
| `["pr-runs", prId]` | `usePrRuns` | `hooks/reviews.ts` | polls every 4 s while any run is `running` |
| `["pr-active-runs", prId]` | `usePrActiveRuns` | `hooks/reviews.ts` | polls every 4 s while the list is non-empty |
| `["pr-comments", prId]` | `usePrComments` | `hooks/reviews.ts` | invalidated after posting a comment |
| `["run-trace", runId]` | `useRunTrace` | `hooks/trace.ts` | `retry: false` (a run without a trace returns 404) |
| `["agents"]`, `["agent", id]`, `["provider-models", p]` | `hooks/agents.ts` | | |
| `["repo-intel-state", repoId]` | `useRepoIntelStatus` | `hooks/repo-intel.ts` | polls every 1.5 s when `poll` is on |

`src/lib/hooks/index.ts` re-exports every hooks file, so `@/lib/hooks` and
`@/lib/hooks/reviews` both work. Tests mock the **exact specifier** a component imports.

## 3. Live runs: SSE and polling

**Starting a run.** `useRunReview` posts to `/pulls/:id/review`. The server
returns run ids straight away and does the work in the background. The PR page
then invalidates `pr-active-runs`.

**Which runs are live.** That comes from the **server**: `usePrActiveRuns` reads
`agent_runs` rows with `status='running'`. Because the list lives in the DB, it
survives a reload or a switch to another device.

**Live log.** `FindingsTab` renders `RunStatus`, which calls
`useRunEvents(liveRunIds)` (`src/lib/hooks/reviews.ts:168`). That hook works
like this:
- It opens one `EventSource` per run and listens on `onmessage` plus the named
  events `info`, `tool`, `result` and `error`.
- It appends parsed `RunEvent`s and shows a toast for every `error` event.
- `running` becomes false once every stream has errored or closed. The server
  closes the stream when the run completes.
- The events reset whenever the set of run ids changes.

**When a run finishes.** `RunStatus` sees `running` go from true to false and
calls `onDone`. The page then invalidates `pr-active-runs` and `pr-runs` and
refetches `reviews`.

**Trace drawer.** It is opened by `?trace=<runId>` (`[number]/page.tsx:174-182`):
- It calls `useRunEvents` only when its `running` prop is true. The page never
  passes `running`, so the drawer always loads the persisted trace
  (see [../specs/l01-review-ui.md](../specs/l01-review-ui.md) §6).
- Server-side SSE and RunBus behaviour, including restart limitations, is
  described in [../../server/docs/architecture.md](../../server/docs/architecture.md).

## 4. State management

| Kind | Where |
|---|---|
| Server data | React Query cache only. Components never copy it into their own state, except for derived `useMemo` values. |
| Navigation and shareable UI state | URL search params: `?status` on the PR list; `?tab` and `?trace` on PR detail |
| Active repo | `RepoProvider` (`src/lib/repo-context.tsx`): the URL `:repoId` wins, then localStorage, then the first repo |
| Theme, toasts | `src/lib/theme.tsx`, `src/lib/toast.tsx` (`notify.error(...)`) |
| View-local | `useState` (PR list search/sort, hide-low-confidence toggle, focused finding, accordion open) |

There is no Redux, Zustand or other global store.

## 5. API contracts

- **Where types come from.** Import them from `@devdigest/shared`, which maps to
  `src/vendor/shared/index.ts` through the alias in `tsconfig.json` and
  `vitest.config.ts`. `src/lib/types.ts` re-exports a subset (for example
  `PrMeta`) for older imports.
- **Types used by the review UI:**
  - `PrMeta` (`contracts/platform.ts`)
  - `ReviewRecord` and `FindingRecord` (`contracts/review-api.ts`)
  - `RunSummary`, `RunTrace` and `RunEvent` (`contracts/trace.ts`)
  - `FindingActionKind` (`contracts/findings.ts`): `accept | dismiss | learn | reply`.
    The server only implements `accept` and `dismiss`.
- **Drift.** This copy is maintained by hand and already lags the server copy.
  Five files differ; see [../../server/INSIGHTS.md](../../server/INSIGHTS.md). For
  any contract change, edit both copies.

## 6. Localization

- **Loading.** `src/i18n/request.ts` loads every `messages/en/*.json` file and
  registers it under its file name as the namespace. There is a single locale
  (`en`) and no locale routing.
- **Usage.** In client components use `useTranslations("<ns>")`; in server code
  use `getTranslations`. Messages use ICU plurals, for example
  `t("runStatus.findings", { count })`.
- **Namespaces the review UI uses:** `prReview` (list, detail, timeline,
  findings) and `runs` (trace drawer).
- **Files that exist ahead of their UI:** `skills`, `eval`, `brief`, `blast` and others.
- **Adding strings.** Add the key to the right JSON file. No registration step is needed.
