# Client testing

Verified against `client/vitest.config.ts`, `client/src/test/` and every
`*.test.tsx` file on 2026-10-11. CI lanes and the browser e2e suite are covered
in [../../TESTING.md](../../TESTING.md) and [../../e2e/README.md](../../e2e/README.md).

## Commands (inside `client/`)

```sh
pnpm test                                   # vitest run — all src/**/*.test.{ts,tsx}
pnpm exec vitest run src/app/repos          # a subset by path
pnpm typecheck                              # tsc --noEmit (part of the gate)
```

There is no lint script. Tests need no API, database or browser.

## Setup

- **Config** (`vitest.config.ts`):
  - `environment: "jsdom"`, `globals: true`, `css: false`, and the React plugin;
  - the aliases `@`, `@devdigest/shared` and `@devdigest/ui` mirror `tsconfig.json`.
- **Setup file** (`src/test/setup.ts`): registers `@testing-library/jest-dom`
  matchers and stubs `ResizeObserver` (needed by Recharts and the drawer).
- **Location.** Tests sit **next to** the component (`Name/Name.test.tsx`). The one
  exception is `src/test/smoke.test.tsx`, which renders the showcase `Gallery`
  and `DiffViewer` in both themes.

## Current test inventory

| Test | What it guards |
|---|---|
| `src/test/smoke.test.tsx` | the whole `@devdigest/ui` gallery plus `DiffViewer` render in dark and light |
| `FindingCard.test.tsx` | Accept / Dismiss buttons fire `onAction` |
| `FindingsPanel.test.tsx` | toolbar + a finding card render; empty state when nothing matches |
| `RunHistory.test.tsx` | outcome badge per status: rejected / approved / reviewed / error / running |
| `RunStatus.test.tsx` | renders nothing without run ids (live streaming itself is untested) |
| `RunTraceDrawer.test.tsx` | trace tabs + stats render; switching to the Live log tab |
| `RunReviewDropdown.test.tsx` | run-all / run-one menu |
| `VerdictBanner.test.tsx` | verdict, counts, score |
| `AgentEditor.test.tsx`, `AgentCard.test.tsx` | agent screens |

Pages (`page.tsx`) have no tests.

## Mocking conventions

1. **Mock the hooks module, not `fetch`.** The client README says "fetch mocked",
   but no test actually mocks `fetch`. Tests replace the hooks with `vi.mock`:

   ```ts
   vi.mock("../../../../../../../lib/hooks/reviews", () => ({
     useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
   }));
   import { FindingsPanel } from "./FindingsPanel"; // import AFTER vi.mock
   ```

   The path must resolve to the same module the component imports. Vitest matches
   the module, not the string, so a relative path in the test still mocks an
   `@/lib/hooks/trace` import in the component (see `RunTraceDrawer.test.tsx`).
2. **Use real translations.** Load the real JSON file and wrap the component in the provider:

   ```tsx
   import messages from "…/messages/en/prReview.json";
   render(<NextIntlClientProvider locale="en" messages={{ prReview: messages }}>{ui}</NextIntlClientProvider>);
   ```

   A missing key then shows up as a failure in the test rather than in the app.
3. **Mock `next/navigation`** when a component calls `useRouter` or `useSearchParams`
   (see `RunReviewDropdown.test.tsx`).
4. **Use a real `QueryClient` only when you have to.** `AgentCard.test.tsx` wraps the
   component in `QueryClientProvider` because it uses real hooks. Prefer hook
   mocks for review UI.
5. **Build fixtures from the shared types** (`FindingRecord`, `RunSummary`, `RunTrace`)
   so that a contract change breaks the build. Every required field must be present,
   including `accepted_at` and `dismissed_at`.
6. Call `afterEach(cleanup)` explicitly, as the existing tests do.

## What to test for a change

- **Pure helpers** (`helpers.ts`): table-driven unit tests, with no rendering.
- **Components:**
  - render with fixtures;
  - assert on visible text and roles;
  - fire events with `fireEvent`;
  - assert that the mocked `mutate` was called with the expected arguments.
- **Live behaviour:** mock `useRunEvents` to return `{ events, running }` and
  rerender to simulate a run finishing.
- **Browser journeys** (seeded stack, no LLM): `e2e/specs/*.flow.json`. Only run
  them when a user-visible flow changes.
