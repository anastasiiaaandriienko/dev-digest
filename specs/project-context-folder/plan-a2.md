# Plan — Project Context amendment A2

- **Status:** Approved (2026-10-20, G2). Approval 1 (usage endpoint package, incl. writing T6) granted 2026-10-20. Approval 2 (run integration test T6) and approval 3 (run hermetic e2e T11) NOT yet granted.
- **Review verdict:** approve-with-changes (sonnet, 0 blockers / 3 major / 7 minor); findings R1–R10 folded in below.

# Development Plan — Project Context amendment A2 (3-panel page redesign)

Spec: `specs/project-context-folder/spec.md` §18 (AC-CTX-107..147), decisions Q24–Q37, assumptions A16–A22, test scenarios T14–T19. ACs 1–106 are done and must not regress. Planner: implementation-planner (opus), MODE PLAN; format follows `plan-a1.md`. Cross-model review: implementation-planner (sonnet), MODE REVIEW — verdict approve-with-changes (0 blockers, 3 major, 7 minor); all 10 findings (R1–R10) folded into this plan.

## Technical assumptions (to confirm)
- A-1 Download icon: first confirm the installed `lucide-react` exports `Download` (Grep `client/node_modules/lucide-react`) (R8); then add `Download` to the `@devdigest/ui` icon list (`client/src/vendor/ui/icons.tsx:4-83`, `:86-165`) from the already installed `lucide-react` — no dependency change. Fallback: existing `ArrowDown`.
- A-2 Roots panel: new route-private `RootsPanel/` wraps the unchanged `RootsEditor` (`RootsEditor.tsx:11-58`); open/closed state inside `RootsPanel`; save (success or failure) does not close the panel (AC-123). The roots summary is rendered OUTSIDE the toggle button, one element per root, so the button's accessible name is exactly "Roots" (AC-121, flow 08) and the AC-13 regex `/docs, \.devdigest\/specs/` (`ContextView.test.tsx:119`) does not match two text nodes.
- A-3 Usage invalidation: inside the shared `useAttachContextDoc` / `useDetachContextDoc` hooks (`client/src/lib/hooks/context.ts:80-87`, `:106-112`) per §18.4, so attach/detach on the skill page and the A1 agent tab also invalidate `["context", repoId, "usage"]` (no visible difference there).
- A-4 Footer "Updated …": only the `Updated {time}` segment is hidden while `dataUpdatedAt` is 0/undefined; the count and kB (AC-118) always render (R4) (fixture `ok()` at `ContextView.test.tsx:49` stays as is). Text = `useFormatter().relativeTime(dataUpdatedAt, now)`, `now` from next-intl `useNow({ updateInterval: 60_000 })`, or a local 60 s interval if that hook is unavailable.
- A-5 Server sort: plain `<`/`>` (UTF-16 code units), not `localeCompare`. The in-memory store gets OPTIONAL helpers: agent `enabled`, skill `enabled`, `linkSkill(agentId, skillId, enabled)`; existing `addAgent`/`addSkill` (`server/test/helpers/context-store.ts:37-42`) unchanged.
- A-6 One SQL statement for `usageByPath`, all columns fully qualified: `UNION ALL` of direct and via-skill parts, `count(distinct agent_id)` grouped by path (server INSIGHTS 2026-10-15: unqualified columns in a single-table select silently give 0; only the integration test catches it).
- A-7 Download: temporary `<a download>` appended to `document.body`, clicked, removed, then `URL.revokeObjectURL`. jsdom lacks `URL.createObjectURL`, tests stub it.

## Architecture
- Client page: `ContextView` (`ContextView.tsx:57-170`) becomes `div[flex; height calc(100vh-52px); minHeight 0]` (precedent `AgentsListView/styles.ts:6`):
  - Docs panel: header, toolbar (Re-index unchanged from `:76-85` + Download), search, states/banner, list `ul` (`flex 1; overflowY auto; minHeight 0`), `RootsPanel`, footer.
  - Preview panel: header row OUTSIDE `data-testid="doc-preview"` (`DocPreview.tsx:22`) with file name, Preview/Edit (Edit disabled), usage indicator; body container (`overflowY auto; minHeight 0`) with `<DocPreview fill>` then `<AgentAttachments>` (`ContextView.tsx:169`).
- DocPreview: optional `fill` prop; default keeps `s.body.maxHeight: 520` (`context-doc-preview/styles.ts:22`); A1 tab (`ContextTab.tsx:249`) passes nothing.
- Download source: `useContextFile(repoId, selected).data` — same cache key as the preview (`hooks/context.ts:19,61-68`), no request.
- New hook: `contextUsageKey(repoId) = ["context", repoId, "usage"]`; `useContextUsage` → `GET /repos/:id/context/usage`, `retry: false`. Re-index refetches only the list query (Q36).
- Server route → service → store:
  - Route `GET /repos/:id/context/usage` in `routes.ts` (pattern `:55-62`, `IdParams` `:14`) + header comment line (`:23-32`).
  - `ContextService.usage` = `repoOf` (`service.ts:45-49`, 404 before any usage query) → `store().usageByPath` (503 path as `:39-43`) → sort → DTO. No walk, no `readDoc`, no clone check.
  - Port `ContextStore.usageByPath(workspaceId, repoId): Promise<{ path; agentCount }[]>` (`types.ts:57-95`).
  - Drizzle in `ContextRepository` (`repository.ts:46`); via-skill part mirrors `effectiveSkills` (`agents/repository.ts:250-270`): `skills.workspace_id = W`, `skills.enabled`, `agent_skills.enabled`, `agents.workspace_id = W`; both attachment tables filtered by `workspace_id` and `repo_id`.
- Contracts: `ContextUsageItem`, `ContextUsage` after `ContextReorderRequest` (`platform.ts:376-382`, both copies), byte-identical; client imports type-only (client INSIGHTS 2026-10-15 "barrel runtime import").
- Markdown: add `table` (wrapper `overflowX: auto`), `thead`, `tbody`, `tr`, `th`, `td` renderers to `components` (`Markdown.tsx:37-91`); `remarkGfm` and `disallowedElements` unchanged (`:34-36`); alignment passed from hast `align`/`style.textAlign`.
- Not changed: `RootsEditor`, `AgentAttachments` (+test), `ContextDocAttachments`, `ContextDocStatus`, Agent editor `ContextTab` (+tests), skill `ContextTab`, `for-run.ts`, executor, trace, reviewer-core, DB schema/migrations, seed, `scripts/e2e.sh`, workflows, dependencies, lockfiles.

## Approvals required (by name)
1. APPROVAL REQUIRED — Q27 usage endpoint package: `ContextUsageItem` + `ContextUsage` in both `platform.ts` copies (T3); `ContextStore.usageByPath` + `ContextRepository` implementation + in-memory store (T4); `ContextService.usage` + `GET /repos/:id/context/usage` (T5); client `useContextUsage` consuming it (T7, T10).
2. APPROVAL REQUIRED — run integration test `server/test/context.it.test.ts` for AC-131/137 (T6). Writing it is part of item 1.
3. APPROVAL REQUIRED — run hermetic e2e for flow 08 (T11). Editing the flow JSON is part of the change.
4. Shared `Markdown` primitive change for all consumers (T1): confirmed by A2 approval (§16).
- Not needed: migration, schema, dependency/lockfile, seed/e2e.sh/workflow edits, paid LLM. No SPEC_GAP.

## Tasks
Checks: [C] = `cd client && pnpm typecheck && pnpm test`; [S] = `cd server && pnpm typecheck` then `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`. Package checks sequential only.

### T1 — GFM tables in the shared Markdown renderer
- AC: 141, 142, 143 · client · implementer · Skills: engineering-insights (read), frontend-architecture, react-best-practices, react-testing-library, security
- Files: M `client/src/vendor/ui/primitives/Markdown.tsx`; M `client/src/vendor/ui/primitives/Markdown.test.tsx` (add cases only). Depends: —
- Steps: table renderers per §18.4 (`border: 1px solid var(--border)`, `padding: 6px 10px`, `th` background `var(--bg-hover)`); keep alignment; no change to `img`/link handling.
- Acceptance: AC-141 styled table in `overflowX: auto` wrapper; AC-142 `:--`, `:-:`, `--:` alignment on th/td; AC-143 the 5 existing cases unedited and passing.
- Tests: "AC-CTX-141 renders a GFM table with bordered cells in an overflow-x wrapper", "AC-CTX-142 keeps column alignment on th/td", "AC-CTX-143 table cells drop images and neutralise javascript: links".
- Regression (unedited): `FindingCard.test.tsx`, `CreateConventionSkillModal.test.tsx`, `SkillDetailView.test.tsx` (`:114`), `CreateSkillModal.test.tsx` (`:58`), `ContextTab.test.tsx`.
- Checks [C] · Risks: visual change for every consumer (§18.8); exact alignment prop shape. · Commit C1

### T2 — DocPreview optional `fill` prop
- AC: 146, 108 · client · Skills: engineering-insights, frontend-architecture, react-best-practices, react-testing-library
- Files: M `client/src/components/context-doc-preview/DocPreview.tsx` (`:12`); M `…/styles.ts` (add `bodyFill` without `maxHeight`); A `…/DocPreview.test.tsx`. Depends: —
- Acceptance: default keeps `maxHeight: 520`; `fill` removes it; A1 `ContextTab.tsx:249` and `ContextTab.test.tsx` (incl. AC-89) untouched and passing.
- Tests: "AC-CTX-146 default body keeps the 520px cap", "AC-CTX-146 fill removes the cap and keeps read-only content".
- Checks [C] · Commit C2

### T3 — APPROVAL REQUIRED: ContextUsageItem / ContextUsage in both copies
- AC: 127, 140 · contracts · Skills: zod
- Files: M `server/src/vendor/shared/contracts/platform.ts`, M `client/src/vendor/shared/contracts/platform.ts` (after `:382`, text exactly as §18.5). Depends: approval 1
- Acceptance: AC-140 byte-identical; AC-127 `agent_count` positive int.
- Checks: `cd server && pnpm typecheck`, then `cd client && pnpm typecheck` · Commit C3

### T4 — APPROVAL REQUIRED: ContextStore.usageByPath (port, Drizzle, in-memory)
- AC: 128, 129, 130, 131, 135, 136, 138 · server · Skills: engineering-insights, onion-architecture, drizzle-orm-patterns, security
- Files: M `server/src/modules/context/types.ts`, M `server/src/modules/context/repository.ts`, M `server/test/helpers/context-store.ts`. Depends: T3
- Steps: port JSDoc "distinct agents per stored path; status/roots/clone ignored"; one statement (A-6): direct part `agent_context_docs` (ws, repo) ⋈ `agents` (ws); via-skill part `skill_context_docs` (ws, repo) ⋈ `skills` (ws, enabled) ⋈ `agent_skills` (enabled) ⋈ `agents` (ws); no `agents.enabled` filter. Select `count(distinct u.agent_id)::int` with columns referenced from the subquery alias (`.as('u')`); `agent_skills` joins use explicit `eq()` on both ids (R6). In-memory: same rules over new optional helpers (A-5); count `usageCalls`; return rows unsorted so the service sort (AC-127) is actually tested (R6).
- Acceptance: AC-138 one statement, every table scoped by `workspace_id` (`agent_skills` through joins).
- Checks [S] · Risks: Drizzle unqualified-column pitfall; missing ws join leaks counts (§18.8). · Commit C4

### T5 — APPROVAL REQUIRED: ContextService.usage + GET route + unit tests
- AC: 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 139 · server · Skills: onion-architecture, fastify-best-practices, security
- Files: M `service.ts`, M `routes.ts` (route + header comment), A `server/test/context-usage.test.ts` (setup as `context-routes.test.ts:34-57`, which stays unchanged). Depends: T4
- Tests: "AC-CTX-127 returns 200 ContextUsage sorted by path (UTF-16)"; "AC-CTX-128 an agent attached directly and via skills counts once"; "AC-CTX-129 skill link counts only when agent_skills.enabled and skills.enabled"; "AC-CTX-130 disabled agents are counted"; "AC-CTX-131 other repo and other workspace rows are not counted"; "AC-CTX-132 unknown or foreign repo → 404, no usageByPath call"; "AC-CTX-133 non-uuid id → 422"; "AC-CTX-134 uncloned repo → 200, walk/readDoc spies not called" (ContextService deps as `context-routes.test.ts:175-182`); "AC-CTX-135 missing/outside_roots paths still counted"; "AC-CTX-136 discovered but unused docs are absent from items"; "AC-CTX-139 no writes (inserts/rootsSaves/rows unchanged) and no LLM access" (container holds only `contextStore`).
- Checks [S] · Commit C5

### T6 — Integration test AC-131/137 (write with approval 1; RUN = APPROVAL REQUIRED item 2)
- AC: 131, 137, 138 · server · test-writer · Skills: drizzle-orm-patterns, security
- Files: M `server/test/context.it.test.ts` (reuse `newRepo`/`newAgent`/`newSkill`/`secondWorkspace`, `:105-172`). Depends: T5
- Fixture (repo R1, workspace W1): A1 direct P; A2 via enabled skill + enabled link; A3 direct + via 2 skills; A4 link disabled; A5 skill disabled; A6 `agents.enabled=false` direct; A7 P on R2; W2 agent/skill holding P for a W2 repo + a W2 skill linked to a W1 agent. Plus (R2, direct DB inserts — the HTTP attach path rejects these): (a) `agent_context_docs` row `workspace_id=W2, repo_id=R1, path=P`; (b) `agent_context_docs` row `workspace_id=W1, repo_id=R1, path=P` whose agent is in W2; (c) `skill_context_docs` row `workspace_id=W2, repo_id=R1, path=P` on a W1 skill linked to an enabled W1 agent; (d) a W1 skill with a W1 doc row P linked to a W2 agent. Expected P = 4 (A1, A2, A3, A6); W2 auth → 404.
- Test: "AC-CTX-137 usage counts on Postgres match AC-127..131 across workspaces, repos and disabled links".
- Checks (approval only): `cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/context.it.test.ts` · Commit C6

### T7 — APPROVAL REQUIRED: useContextUsage + invalidation on attach/detach
- AC: 126, 125 · client · Skills: frontend-architecture, react-best-practices, next-best-practices, react-testing-library
- Files: M `client/src/lib/hooks/context.ts` (key, hook `retry: false`, attach/detach `onSuccess` also invalidates usage, header comment); A `client/src/lib/hooks/context.test.tsx` (real QueryClient + mocked `@/lib/api`, pattern `agent-skills.test.tsx:69`). Depends: T3
- Tests: "AC-CTX-126 attach success invalidates ['context', repoId, 'usage']", "AC-CTX-126 detach success invalidates the usage key", "AC-CTX-125 usage query does not retry".
- Checks [C] · Commit C7

### T8 — i18n keys + RootsPanel (collapsed by default)
- AC: 121, 122, 123 · client · Skills: frontend-architecture, react-best-practices, react-testing-library
- Files: M `client/messages/en/context.json` (new §18.4 keys + `empty.body` copy A20; values used by tests/flow 08 unchanged); A `client/src/app/repos/[repoId]/context/_components/RootsPanel/{RootsPanel.tsx,index.ts,styles.ts,RootsPanel.test.tsx}`. Depends: —
- Steps: toggle `button` with `aria-expanded` + `aria-controls`; its accessible name is the visible text "Roots" only; the controlled region gets an `id` only (no `aria-label` equal to `roots.label` "Context roots", so `getByLabelText` in AC-12 stays unique) (R5); summary next to it (A-2); `RootsEditor` mounted only while open (A18). `empty.body` keeps the `{roots}` interpolation; only the "above" wording changes (A20, R1).
- Tests: "AC-CTX-121 collapsed: toggle aria-expanded=false, summary shown, no textarea", "AC-CTX-122 toggle expands RootsEditor and collapses again", "AC-CTX-123 a save error keeps the panel expanded and shows the alert".
- Checks [C] · Commit C8

### T9 — ContextView 3-panel layout, toolbar, Download, footer, preview header, attach placement
- AC: 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 144, 145 · client · Skills: frontend-architecture, react-best-practices, next-best-practices, react-testing-library
- Files: M `ContextView/{ContextView.tsx,styles.ts,helpers.ts}`; A `ContextView/helpers.test.ts` (`fileName`, `totalSize`); M `ContextView/ContextView.test.tsx`; M `client/src/vendor/ui/icons.tsx` (A-1). Depends: T2, T8
- Allowed edits to existing `ContextView.test.tsx` content (R3), exhaustive: (1) one Roots-toggle click at the start of "AC-CTX-12" and of "AC-CTX-13 saving roots"; (2) the `AgentAttachments` mock becomes a button-free stub `<div data-testid="agent-attachments"/>`; (3) a `useContextUsage` entry in the hooks mock factory (T10); (4) widening the `ListQ` type with an optional `dataUpdatedAt`. Case bodies and assertions of existing cases are otherwise untouched (AC-144); the `ok()` fixture is not edited — new AC-118/119 cases build their own fixtures with a numeric `dataUpdatedAt` (R4).
- New tests: "AC-CTX-107 root height calc(100vh - 52px), no maxWidth, docs panel then preview panel"; "AC-CTX-108 list and preview body are overflowY auto, minHeight 0"; "AC-CTX-109 docs panel order"; "AC-CTX-110 rows: icon, path, kB, aria-pressed on selected only"; "AC-CTX-111 header outside doc-preview shows the file name and Preview pressed"; "AC-CTX-112 Edit is disabled with the editDisabled description, sends nothing"; "AC-CTX-113 doc-preview has no controls"; "AC-CTX-115 Download saves the cached content as spec.md, no fetch" (stub createObjectURL/revokeObjectURL, spy `HTMLAnchorElement.prototype.click`, read Blob via FileReader); "AC-CTX-116 Download disabled with no selection, loading or error"; "AC-CTX-117 no new/import/save controls"; "AC-CTX-118 footer count and kB follow the searched list"; "AC-CTX-119 Updated {time} re-evaluates every 60s, no 'index'" (fake timers); "AC-CTX-120 no token text"; "AC-CTX-121 page opens with Roots collapsed"; "AC-CTX-144 states render inside the docs panel"; "AC-CTX-123 a roots save error keeps the Roots panel expanded" (mock `useUpdateContextRoots` returns `error: new Error`) (R7); "AC-CTX-145 attach section after and outside doc-preview inside the preview body".
- Acceptance additions: (R1) the unedited "AC-CTX-13 empty state names roots" case passes and exactly one element matches `/docs, .devdigest/specs/`; (R10) no new button's accessible name contains "Attach", "Detach" or "Roots" except the intended Roots toggle (the Download button must not contain "Attach"); (R8) if `Download` is not exported, use `ArrowDown`; (R9) the preview header reserves the slot for the usage indicator, which renders nothing until T10 — C9 alone satisfies AC-111 only partially, C9 and C10 may land together.
- Checks [C] · Risks: jsdom may drop `calc(100vh - 52px)` (fallback: assert `s.page.height` + `style.height`); any control inside `doc-preview` breaks AC-52/113; header must not render a button whose name contains "docs/spec.md". · Commit C9

### T10 — APPROVAL REQUIRED: usage indicator in the preview header
- AC: 111, 114, 124, 125 · client · Skills: frontend-architecture, react-best-practices, react-testing-library
- Files: M `ContextView/ContextView.tsx`; M `ContextView/ContextView.test.tsx` (add `useContextUsage` to the hooks mock; new cases only). Depends: T7, T9
- Tests: "AC-CTX-124 shows Used by N agents for an exact, case-sensitive path match, else Not used by any agent"; "AC-CTX-125 loading or error renders no indicator and the page keeps working"; "AC-CTX-114 Re-index refetches the list only, not usage". Existing "AC-CTX-53" unedited.
- Checks [C] · Commit C10

### T11 — e2e flow 08: expand Roots first (edit in plan; RUN = APPROVAL REQUIRED item 3)
- AC: 147 · e2e · test-writer · follow `e2e/CLAUDE.md`
- Files: M `e2e/specs/08-project-context.flow.json`: insert before step `:11` exactly `{ "cmd": ["find", "role", "button", "click", "--name", "Roots"], "label": "expand the Roots panel" }`; no other step changes. Depends: T9
- Checks: JSON validity by review; run only with approval: `cd e2e && npm run e2e:hermetic` (Git Bash/WSL).
- Risks: agent-browser `--name` exact vs substring unverified; "Roots" unique while collapsed (§18.8); step 19 `--name "Attach"` requires no other button containing "Attach" (R10); after the Roots click the attach controls sit in the preview scroll container — agent-browser `click` scrolls into view, otherwise a scroll step would be a further flow edit needing approval (R10). Other flow 08 steps (8, 12–22) reviewed: unaffected. · Commit C11

## AC coverage
| AC-ID | Tasks | Test(s) | Verification |
|---|---|---|---|
| 107, 109, 110, 112, 113, 116, 117, 118, 120, 144, 145 | T9 | ContextView.test.tsx | RTL |
| 108 | T2, T9 | ContextView.test.tsx + DocPreview.test.tsx | RTL + manual 1280×720 |
| 111 | T9, T10 | ContextView.test.tsx | RTL |
| 114 | T9, T10 | ContextView.test.tsx (existing AC-53 + new) | RTL |
| 115 | T9 | ContextView.test.tsx | RTL |
| 119 | T9 | ContextView.test.tsx (fake timers) | RTL |
| 121 | T8, T9 | RootsPanel.test.tsx + ContextView.test.tsx | RTL |
| 122 | T8 | RootsPanel.test.tsx | RTL |
| 123 | T8, T9 | RootsPanel.test.tsx + ContextView.test.tsx | RTL |
| 124 | T10 | ContextView.test.tsx | RTL |
| 125 | T7, T10 | context.test.tsx + ContextView.test.tsx | unit/RTL |
| 126 | T7 | client/src/lib/hooks/context.test.tsx | unit (hook) |
| 127 | T3, T5 | context-usage.test.ts | unit |
| 128, 129, 130, 135, 136 | T4, T5 | context-usage.test.ts | unit |
| 131 | T4, T5, T6 | context-usage.test.ts + context.it.test.ts (incl. workspace_id filter on both doc tables and the agents join, R2) | unit + integration (approval) |
| 132, 133, 134, 139 | T5 | context-usage.test.ts | unit |
| 137 | T6 | context.it.test.ts (incl. R2 cross-workspace rows) | integration (approval) |
| 138 | T4, T6 | — | manual code review (+ it) |
| 140 | T3 | — | manual code review (diff of both copies) |
| 141, 142, 143 | T1 | Markdown.test.tsx + consumer suites | unit |
| 146 | T2 | DocPreview.test.tsx + unedited ContextTab.test.tsx | RTL |
| 147 | T11 | 08-project-context.flow.json | e2e (approval) |

## Commits (proposed; created only on user request)
| Commit | Tasks | Message |
|---|---|---|
| C1 | T1 | feat(ui): render GFM tables in the shared Markdown renderer |
| C2 | T2 | feat(client): add optional fill layout to DocPreview |
| C3 | T3 | feat(contracts): add ContextUsage to both shared copies |
| C4 | T4 | feat(server): count context doc usage per path in the store |
| C5 | T5 | feat(server): add GET /repos/:id/context/usage |
| C6 | T6 | test(server): cover context usage counts on Postgres |
| C7 | T7 | feat(client): add useContextUsage and invalidate it on attach/detach |
| C8 | T8 | feat(client): add collapsible Roots panel and A2 context strings |
| C9 | T9 | feat(client): redesign Project Context as a 3-panel page |
| C10 | T10 | feat(client): show "Used by N agents" for the selected doc |
| C11 | T11 | test(e2e): expand the Roots panel in flow 08 |

## Order
- Before approval 1: T1, T2, T8 (independent), then T9.
- After approval 1: T3 → T4 → T5 → T6 (write only); T7 → T10 → T11 (edit). T7 needs only T3.
- Approvals 2 and 3 last: run T6 and T11.

## Final verification
1. `cd client && pnpm typecheck && pnpm test`
2. `cd server && pnpm typecheck`
3. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
4. APPROVAL: `cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/context.it.test.ts`
5. APPROVAL: `cd e2e && npm run e2e:hermetic`
- Manual: `/repos/<id>/context` at 1280×720 independent scrolling; tables in findings/comments/skill bodies; Download produces a file; `/agents/<id>?tab=context` unchanged (520 px cap).

## For reviewers
- architecture-reviewer: route → service → store layering; single-statement SQL; `RootsPanel` layout; `fill` the only DocPreview change; A-3 invalidation in shared hooks; no new constants outside the context module.
- security-reviewer: workspace scoping of every table in the usage statement (`agent_skills` via joins); 404 before any query for foreign repos; no file reads on usage; table cells still drop `img` and neutralise `javascript:`; Download serves only redacted/truncated text.
- plan-verifier: every unit AC maps to an `it("AC-CTX-…")`; existing `ContextView.test.tsx` content edited only by the four R3 items (Roots clicks, AgentAttachments stub, useContextUsage mock entry, optional `dataUpdatedAt` on `ListQ`) (AC-144); `ContextTab.test.tsx`, `AgentAttachments.test.tsx`, `context-routes.test.ts` unedited; 138/140 manual; 131/137 and 147 need approval to run.

## Unknowns
- Whether jsdom keeps `calc(100vh - 52px)` in `element.style` (fallback in T9).
- next-intl is 3.26.5 and exports `useNow` and `useFormatter().relativeTime` (verified in review).
- How react-markdown passes GFM alignment (`align` attribute or `style.textAlign`) — check in T1.
- agent-browser `--name` matching (exact or substring) unverified (§18.8).
