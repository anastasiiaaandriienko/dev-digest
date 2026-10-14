# Client components

Verified against `client/src` on 2026-10-11. The `@devdigest/ui` library itself
(layers, tokens, theming) is documented in
[../src/vendor/ui/README.md](../src/vendor/ui/README.md); this page covers how app
code is organized around it.

## Where components live

| Location | What goes there |
|---|---|
| `src/app/<route>/_components/<Name>/` | Components private to one route. Nested children go in `<Name>/_components/<Child>/` (for example `RunTraceDrawer/_components/TraceBody`). |
| `src/components/<kebab-name>/` | Shared app-level pieces: `app-shell` (frame, command palette, shortcuts), `page-shell`, `diff-viewer`, `repo-not-found`, `mermaid-diagram`, `showcase` |
| `src/vendor/ui/` (`@devdigest/ui`) | The design system: primitives, kit, charts, shell, `LiveLogStream` |
| `src/lib/` | Hooks, the API client and providers. No JSX components except providers. |

## Folder convention

```
Name/
  Name.tsx        // "use client"; named export `Name`
  index.ts        // export { Name, Name as default } from "./Name";
  styles.ts       // export const s = { … } (static objects + functions for dynamic styles)
  constants.ts    // lookup tables, thresholds, keyboard maps
  helpers.ts      // pure functions (easy to unit-test)
  Name.test.tsx   // co-located test
```

**Templates to copy:**
- `[number]/_components/VerdictBanner/`: all six files.
- `[number]/_components/FindingsPanel/`: the logic lives in `helpers.ts` and the tables in `constants.ts`.
- `[number]/_components/RunStatus/`: the smallest component that wraps a hook.

**Legacy files that break the convention** (don't copy these):
- `RunHistory/` has no `index.ts` or `styles.ts`, keeps its style constants and
  `outcomeOf()` inside `RunHistory.tsx`, and is imported as `../RunHistory/RunHistory`.
- `ReviewRunAccordion/` and `RunTraceDrawer/_components/FindingsSection/` use inline style literals.
- `FindingsTab.tsx`, `ReviewRunAccordion.tsx` and `FindingsSection.tsx` hard-code
  English strings (for example "Live review", "Review runs", `finding{s}`) instead of
  using `prReview` / `runs` messages.

If you touch one of these, it is fine to move it toward the convention in the
same change. Don't do a broad refactor without asking.

## Styling

- **How styles are written.** Use inline `style` objects that reference CSS
  variables from `src/vendor/ui/styles.css`, such as `var(--crit)`,
  `var(--text-muted)` and `var(--bg-surface)`. Theme switching happens through
  `data-theme` on `<html>`. Never hard-code colors.
- **Tailwind.** Tailwind 4 is wired through PostCSS (`postcss.config.mjs`,
  `globals.css`), but components don't use utility classes. Stay with `s` objects.
- **Shared classes.** The `mono` class and the `ddspin` animation are used across components.
- **Severity styling.** Use `SeverityBadge` / `SEV` from `@devdigest/ui`
  (`primitives/tokens.ts`); they cover `CRITICAL`, `WARNING`, `SUGGESTION` and `INFO`.
  `FindingsSection` has its own `SEV_COLOR` map without `INFO`; prefer the shared tokens.

## Reusable UI patterns already in the codebase

| Need | Use |
|---|---|
| Loading / empty / error | `Skeleton`, `EmptyState`, `ErrorState` (`fullScreen` for page-level) |
| Score ring | `CircularScore` (PR list, timeline, verdict banner) |
| Status or count chip | `Badge` (`color`, `bg`, `icon`, `dot`, `mono`) |
| Side panel | `Drawer` (trace drawer, 720 px) |
| Tabs | `Tabs` (trace drawer); PR detail tabs are custom in `PrDetailHeader` |
| Streaming log | `LiveLogStream` (`log: LogLine[]`, `running`, `height`; has its own filter input) |
| Toggle | `Toggle` ("hide low confidence") |
| Charts (unused so far) | `MetricCard`, `Donut`, `LineChart`, `BarRow`, `Sparkline` |
| Keyboard | global shortcuts in `src/components/app-shell/hooks`; per-panel `j/k/a/d` in `FindingsPanel` |
| Toasts | `notify.error(...)` from `src/lib/toast.tsx` |

## Review UI component map

```
[number]/page.tsx
├─ PrDetailHeader          tabs (overview · findings · diff) + RunReviewDropdown
├─ OverviewTab / DiffTab
├─ FindingsTab             (tab=findings)
│  ├─ RunStatus            live SSE log for in-flight runs
│  ├─ RunHistory           timeline: runs + commits, outcome badge, score, open-trace, delete
│  └─ ReviewRunAccordion×N one per persisted review
│     ├─ VerdictBanner
│     └─ FindingsPanel     hide-low-confidence, severity sort, j/k/a/d
│        └─ FindingCard×N  severity, title, location, rationale, fix, Accept / Dismiss
└─ RunTraceDrawer          ?trace=<runId>: Trace tab (TraceBody → FindingsSection …) + Live log tab
pulls/page.tsx → FilterBar + PRRow×N (title, author, size, score, status, updated)
```

## Adding or changing a component

1. Create the folder under the narrowest scope: route `_components/` before `src/components/`.
2. Put data access in a hook in `src/lib/hooks/<area>.ts`, and pass data and callbacks down as props.
3. Add strings to `messages/en/<ns>.json` and read them with `useTranslations`.
4. Put styles in `styles.ts`, built on CSS variables, and use `@devdigest/ui` primitives first.
5. Add `Name.test.tsx` (see [testing.md](testing.md)), then run `pnpm typecheck && pnpm test`.
6. If you added a component to `@devdigest/ui` itself, also add it to
   `src/components/showcase/Showcase.tsx` so the smoke test renders it.
