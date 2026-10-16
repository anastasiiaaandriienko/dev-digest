---
name: frontend-architecture
description: Where code goes in the DevDigest client (client/, Next.js 15 App Router) — pages, route-private and shared components, React Query hooks, the API client, styles, i18n messages, contracts and tests, plus the naming conventions, with examples from this repo. Use when adding or moving a page, component, hook, style or translation in client/, or when reviewing client changes for structure. Repo-specific; for generic React, Next.js or RTL guidance use react-best-practices, next-best-practices and react-testing-library.
metadata:
  type: instruction
  scope: client
---

# Frontend architecture (client/)

How the DevDigest studio UI is laid out, so new code lands in the right place.
Facts here are taken from `client/src` and `client/docs/*`; the longer references are
[client/docs/architecture.md](../../../client/docs/architecture.md),
[client/docs/components.md](../../../client/docs/components.md) and
[client/docs/testing.md](../../../client/docs/testing.md). Package rules:
[client/AGENTS.md](../../../client/AGENTS.md).

Not covered here (use the existing skills): generic React patterns → `react-best-practices`;
App Router / RSC rules → `next-best-practices`; test-writing technique → `react-testing-library`.

## Data flow in one line

`page.tsx` (thin, `"use client"`) → route `_components/*` (props + callbacks) →
hooks in `src/lib/hooks/<area>.ts` (React Query) → `src/lib/api.ts` (`api`, `apiFetch`,
`ApiError`) → Fastify API on `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`).

Components never call `fetch` directly and never talk to the DB or GitHub. Anything the
UI needs that the API does not serve requires a server endpoint first.

## Where things belong

| What | Location | Example in the repo |
|---|---|---|
| Route (page) | `src/app/<route>/page.tsx`, default export, kept thin | `src/app/agents/page.tsx`, `src/app/repos/[repoId]/pulls/[number]/page.tsx` |
| Dynamic segment | `[param]` folder, read with `useParams` | `src/app/agents/[id]/page.tsx` (`useParams<{ id: string }>()`) |
| Component used by ONE route | `src/app/<route>/_components/<Name>/` | `src/app/agents/_components/AgentCard/` |
| Child of such a component | `<Name>/_components/<Child>/` | `agents/[id]/_components/AgentEditor/_components/ConfigTab/` |
| Shared app-level component | `src/components/<kebab-name>/` | `src/components/app-shell/`, `page-shell/`, `diff-viewer/` |
| Design-system primitive / kit | `src/vendor/ui/` imported as `@devdigest/ui` | `Modal`, `Drawer`, `Tabs`, `Toggle`, `Badge`, `EmptyState`, `Markdown` |
| Sidebar navigation | `src/vendor/ui/nav.ts` (`NAV`, `SETTINGS_ITEM`) + `src/components/app-shell/helpers.ts` (`activeKeyFor`) | — |
| React Query hooks | `src/lib/hooks/<area>.ts`, re-exported from `src/lib/hooks/index.ts` | `src/lib/hooks/agents.ts` (`useAgents`, `useUpdateAgent`) |
| Pure, shared logic (no JSX) | `src/lib/<name>.ts` + `<name>.test.ts` | `src/lib/findings.ts`, `src/lib/format.ts`, `src/lib/run-phases.ts` |
| API contracts (Zod + types) | `src/vendor/shared` imported as `@devdigest/shared` (hand-kept copy of the server's) | `Agent`, `PrMeta`, `ReviewRecord` |
| UI strings | `messages/en/<namespace>.json`, read with `useTranslations("<namespace>")` | `messages/en/prReview.json`, `agents.json`, `skills.json` |
| Styles | `<Name>/styles.ts` exporting `s` | `FindingsPopover/styles.ts` |
| Tests | next to the code: `<Name>/<Name>.test.tsx`, `src/lib/*.test.ts` | `FindingsPanel/FindingsPanel.test.tsx`, `src/lib/findings.test.ts` |

Scope rule: create a component in the **narrowest** place first (route `_components/`),
and move it to `src/components/` only when a second route needs it.

## Component folder convention

```
Name/
  Name.tsx        // "use client"; named export `Name`
  index.ts        // export { Name, Name as default } from "./Name";
  styles.ts       // export const s = { … } — static objects + functions for dynamic styles
  constants.ts    // lookup tables, thresholds, keyboard maps (optional)
  helpers.ts      // pure functions, unit-tested (optional)
  Name.test.tsx   // co-located test
```

Templates to copy: `src/app/agents/_components/AgentCard/` (all six files),
`pulls/[number]/_components/FindingsPanel/` (logic in `helpers.ts`, tables in `constants.ts`). Do **not** copy
`RunHistory/` or `ReviewRunAccordion/` (no `styles.ts`, inline literals, hard-coded
English) — see `client/docs/components.md` "Legacy files".

## Naming conventions

- Component folders and files: **PascalCase** (`AgentCard/AgentCard.tsx`); one component per folder.
- Shared component folders: **kebab-case** (`src/components/app-shell/`).
- Hooks: `useXxx` in `src/lib/hooks/<area>.ts` (`useAgent`, `useFindingAction`).
- Query keys: arrays starting with the resource: `["agents"]`, `["agent", id]`,
  `["reviews", prId]`, `["pr-runs", prId]`. A mutation invalidates every key it affects.
- Styles object is always `s`; constants `UPPER_SNAKE_CASE`; quotes are **double**.
- Contract fields stay snake_case as the API sends them (`head_sha`, `findings_summary`);
  severity values are uppercase (`CRITICAL | WARNING | SUGGESTION`, UI also knows `INFO`).
- Imports: `@devdigest/ui` for UI, `@devdigest/shared` for contracts, `@/…` (= `src/…`)
  or relative paths for app code.

## Styling and i18n

- Inline `style={s.x}` built on CSS variables from `src/vendor/ui/styles.css`
  (`var(--crit)`, `var(--text-muted)`, `var(--bg-surface)`). Never hard-code colours;
  Tailwind is installed but components don't use utility classes.
- Severity colours come from `SEV` / `SeverityBadge` in `@devdigest/ui`.
- Every new user-facing string goes to `messages/en/<ns>.json`; each file is auto-loaded
  as namespace `<ns>`. Reuse an existing namespace (`skills.json`, `conventions.json`
  already exist) before adding one.

## State

Server state = React Query; navigation state = URL (`?tab=`, `?trace=`, `?status=`);
active repo = `RepoProvider` (`src/lib/repo-context.tsx`); everything else = local
`useState`. There is no global store — don't add one.

## Tests

- Mock the **hooks module**, not `fetch`: `vi.mock("<path>/lib/hooks/<area>", () => ({ … }))`,
  then import the component. Wrap renders in `NextIntlClientProvider` with the real
  `messages/en/<ns>.json`.
- Pure helpers get table-driven unit tests without rendering.
- Gate: `cd client && pnpm typecheck && pnpm test` (there is no lint script).
- Vitest is 2.1 — newer matchers such as `toHaveBeenCalledExactlyOnceWith` do not exist
  (see `client/INSIGHTS.md`).

## Checklist for a client change

1. Page stays thin; UI lives in the narrowest `_components/<Name>/`.
2. Data comes through a hook in `src/lib/hooks/`, with correct query keys and invalidation.
3. Contract changes are made in **both** `client/src/vendor/shared` and `server/src/vendor/shared`.
4. Strings in `messages/en/*.json`; styles in `styles.ts` with CSS variables.
5. Co-located test added or updated; typecheck + tests pass.
