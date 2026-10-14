# CLAUDE.md — client (`@devdigest/web`)

Package-level guide. The root [`../CLAUDE.md`](../CLAUDE.md) (repo layout,
naming, global "do not touch" rules) still applies; this file adds only what is
specific to `client/`. Details live in the linked docs — open them only when needed.

## Architecture in one screen

- **Next.js 15 App Router, React 19.** Routes in `src/app/**/page.tsx`; route files
  stay thin and feature UI lives in colocated `_components/<Name>/` folders.
  Interactive views are client components (`"use client"`) because all data comes
  from React Query hooks.
- **Providers** (`src/app/layout.tsx` → `src/lib/providers.tsx`): `NextIntlClientProvider`
  → `QueryClientProvider` → `ThemeProvider` → `ToastProvider` → `RepoProvider`.
- **Data:** `src/lib/api.ts` (`apiFetch`, `ApiError`, base `NEXT_PUBLIC_API_BASE`,
  default `http://localhost:3001`) ← hooks in `src/lib/hooks/*.ts` ← components.
  Components never call `fetch` directly.
- **Live runs:** `useRunEvents` opens one `EventSource` per run on `/runs/:id/events`;
  run lists poll every 4 s while something is running.
- **State:** server state = React Query; navigation state = URL (`?tab`, `?trace`,
  `?status`); active repo = `RepoProvider`; everything else is local `useState`.
  No global store.
- **Contracts:** `@devdigest/shared` → `src/vendor/shared` (a hand-kept copy of the
  server's, already behind it). **UI kit:** `@devdigest/ui` → `src/vendor/ui`.
- **i18n:** `next-intl`, single locale `en`; every `messages/en/<ns>.json` is
  auto-loaded as namespace `<ns>`.

## Commands (run inside `client/`)

```sh
pnpm dev          # next dev on :3000 (needs the API on :3001 for data)
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run (jsdom), no API needed
```

No lint script exists — typecheck + tests are the gate. Installing deps needs approval.

## Conventions that bite

- Double quotes. Component folder = `Name/Name.tsx` + `index.ts` (+ `styles.ts`
  exporting `s`, `constants.ts`, `helpers.ts`, `Name.test.tsx` as needed).
- Styling is inline `style={s.x}` objects over CSS variables (`var(--crit)` …);
  Tailwind is installed but components don't use utility classes.
- Import UI only from `@devdigest/ui`, contracts only from `@devdigest/shared`.
- New user-facing strings go to `messages/en/<ns>.json` — but note several existing
  components still hard-code English (see docs/components.md).
- Mutations must invalidate the query keys they affect (`["reviews", prId]`, `["pr-runs", prId]` …).
- Severity values are uppercase (`CRITICAL | WARNING | SUGGESTION`; UI tokens also know `INFO`).

## Boundaries

- Changing a type in `src/vendor/shared` means the server copy must match — edit
  both or ask. Never "fix" drift by editing only this side.
- Don't touch `pnpm-lock.yaml`, `pnpm-workspace.yaml` or dependencies.
- The client has no direct DB/GitHub access; anything new needs a server endpoint first.

## Read When

- **Adding a route, hook, query key, SSE consumer, or touching i18n/contracts** →
  [docs/architecture.md](docs/architecture.md)
- **Creating or changing a component, styles, or using `@devdigest/ui`** →
  [docs/components.md](docs/components.md), then [src/vendor/ui/README.md](src/vendor/ui/README.md)
- **Writing or running tests, mocking hooks or translations** →
  [docs/testing.md](docs/testing.md), then [../TESTING.md](../TESTING.md) for CI and e2e
- **Working on L01 review UI (cost badge, phases, severity filters, popover,
  accept/reject, findings in trace/logs)** → [specs/l01-review-ui.md](specs/l01-review-ui.md)
  and the server side [../server/specs/review-run-cost.md](../server/specs/review-run-cost.md)
- **Need the API behaviour behind a hook (runs, SSE, traces)** →
  [../server/docs/architecture.md](../server/docs/architecture.md)
- **Contract drift between client and server copies** →
  [../server/INSIGHTS.md](../server/INSIGHTS.md)
- **Route map and stack overview** → [README.md](README.md)
- **Repo-wide rules, other packages** → [../CLAUDE.md](../CLAUDE.md)
