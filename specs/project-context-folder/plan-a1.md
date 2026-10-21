# Development Plan — Project Context amendment A1 (Agent editor Context tab)

- **Status:** Approved (2026-10-19, G2) · Approvals granted: T1–T10 incl. Q19 (reorder endpoint, store, both contract copies). Pending: running the AC-CTX-101 integration test (T10).
- **Cross-model review:** implementation-planner (sonnet), MODE REVIEW — approve with changes (2 major, 5 minor); all 7 applied by the main agent 2026-10-19.
- **Spec:** `specs/project-context-folder/spec.md` (Key CTX, Approved 2026-10-18; amendment A1 approved 2026-10-19, commits 34176fc, 794ae3c) — decisions Q18–Q23, AC-CTX-77..106, §17.
- **Planner:** implementation-planner (opus), MODE PLAN. The original `plan.md` (AC-CTX-01..76) is history.
- **Goal:** add a third Agent editor tab, Context, to list, attach, detach, reorder and preview a repo's Project Context docs, using one new reorder endpoint.

## Technical assumptions (to confirm)

- **A-1** Reorder is not optimistic: the list always shows server order; the PUT response is written to `contextDocsKey`; on error the key is invalidated (AC-97). No `scope` queue — controls are disabled while any mutation is pending (AC-96). See client INSIGHTS 2026-10-15 "Optimistic replace…".
- **A-2** `reorderAttachments` returns `ContextAttachmentRow[] | null`; `null` = id set mismatch, checked inside the locked transaction; service maps to `ValidationError` (422, `reason: 'reorder set mismatch'`). Duplicate ids and > 10 ids rejected earlier by the body schema `.refine` (Zod body failure → 422 `validation_error` with `details` in the error handler, `server/src/app.ts:126-131`); the service mismatch uses `ValidationError(…, {reason})` as `service.ts:73`.
- **A-3** ContextTab has its own small `formatKb` in `helpers.ts` (cannot import the route-private `ContextView/helpers.ts:2-5`).
- **A-4** In the not-cloned state (AC-94) the ↑/↓ controls of attached rows stay available (reorder needs no clone); only checkboxes are hidden. `service.reorder` does NOT call `requireCloneRoot` (statuses come from `cloneRootOf` → `missing`, as `service.ts:179-183`).

## Architecture

- Client ContextTab → hooks `client/src/lib/hooks/context.ts:49-96` (list, docs, attach, detach; key `contextDocsKey` `:20-21`) + new `useReorderContextDocs` → `api.put` (`client/src/lib/api.ts:69`) → `PUT /${prefix}/:id/context-docs/order`.
- Route inside the owner loop (`server/src/modules/context/routes.ts:71-114`), reusing `RepoQuery`/`IdParams` (`:19`, `:13`). `ContextService.reorder` = `requireOwner` (`service.ts:134-138`) + `repoOf` (`:45-49`) + store + `toDto` (`:158-170`).
- `ContextStore.reorderAttachments` (`types.ts:57-83`) implemented in `ContextRepository` as a transaction with the same `pg_advisory_xact_lock` key as `insertAttachment` (`repository.ts:136-140`), extracted into one private `lockKey()` helper; UPDATE `order` = 1..n. No schema change (`order` has no unique index, `server/src/db/schema/project-context.ts:26,30,48,52`). Run order already sorts by `order` (`for-run.ts:110`).
- Contract: `ContextReorderRequest = z.object({ ids: z.array(z.string().uuid()).max(10).refine(unique) })` next to `ContextAttachRequest` in BOTH copies (`server|client/src/vendor/shared/contracts/platform.ts:371-372`). `ContextListItem`/`ContextAttachment` unchanged.
- Reused: repo picker pattern (`skills/[id]/…/ContextTab/ContextTab.tsx:17-19`), `ContextDocStatus`, `MAX_ATTACHMENTS`, not-cloned check (`ContextView.tsx:50`), move logic from `SkillsTab/helpers.ts:84-105`, real-QueryClient + mocked `@/lib/api` test pattern (`IntentBlock.sync.test.tsx:15-18`).

## Approvals required

- **Not yet granted:** Q19 reorder backend + contract (T5–T8 and the reorder part of T9); running the AC-101 integration test (T10).
- No migration, no dependency/lockfile change, no paid LLM call, no e2e flow.

## Tasks

Checks: **[C]** `cd client && pnpm typecheck && pnpm test` · **[S]** `cd server && pnpm typecheck` → `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`

### T1 — Move DocPreview to shared components
- AC: AC-CTX-89, 104 · client · implementer
- Files: A `client/src/components/context-doc-preview/{DocPreview.tsx,index.ts,styles.ts}` · D `client/src/app/repos/[repoId]/context/_components/DocPreview/*` · M `…/context/_components/ContextView/ContextView.tsx` (import `:17`)
- Acceptance: AC-104 `ContextView.test.tsx` passes unedited; AC-89 `DocPreview` importable from the shared path. Tests: none new. Checks: [C] · Commit: C1

### T2 — Agent ContextTab component (list, attach/detach, preview, filter, repo, states)
- AC: AC-CTX-82, 83, 84, 87, 88, 89, 90, 91, 92, 93, 94, 105 · client · implementer
- Files: A `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/{ContextTab.tsx,index.ts,helpers.ts,styles.ts,constants.ts,ContextTab.test.tsx,helpers.test.ts}` · M `client/messages/en/context.json` (`agentTab.*`) · Depends on: T1
- Steps: helpers `buildRows`, `rootOf` (longest prefix), `splitPath`, `filterRows`, `formatKb`; repo picker, `useContextList(R,"")`, `useContextDocs("agents",…)`, checkbox attach/detach, limit at 10, `ContextDocStatus`, Preview → side `DocPreview`, badge "a of d attached", helper/footer copy, kB size, no tokens; `REPO_NOT_CLONED` → `notCloned`, no checkbox, attachments listed.
- Tests (`ContextTab.test.tsx`): "AC-CTX-82 …", "AC-CTX-83 …", "AC-CTX-84 …", "AC-CTX-87 …", "AC-CTX-88 …", "AC-CTX-89 …", "AC-CTX-90 …", "AC-CTX-91 …", "AC-CTX-92 …", "AC-CTX-93 …", "AC-CTX-94 …", "AC-CTX-105 …"; (`helpers.test.ts`) "AC-CTX-82 rootOf picks the longest root", "AC-CTX-83 buildRows order", "AC-CTX-90 filterRows is case-insensitive".
- Checks: [C] · Risks: type-only barrel imports. · Commit: C2

### T3 — Wire the third tab (Config | Skills | Context)
- AC: AC-CTX-77, 78, 79, 80, 81 · client · implementer
- Steps (tests): in BOTH `AgentEditor.test.tsx` (`:9-17`) and `AgentEditorView.test.tsx` (`:19-58`) add mocks for `@/lib/hooks/context` (list, docs, attach, detach), the repos hook and `useActiveRepo` (`@/lib/repo-context`), plus a repo fixture so AC-80/81 do not hit the AC-93 no-repo branch; add `context` messages to the providers.
- Files: M `AgentEditor/constants.ts` (`:10-14` + HW2 #35 comment amended), `AgentEditor/AgentEditor.tsx` (comment `:1-5`; `:38` → `hidden={tab !== "config"}`; render ContextTab), `AgentEditorView/AgentEditorView.tsx` (comment only), `client/messages/en/agents.json` (`editor.tabs.context`), `AgentEditor.test.tsx`, `AgentEditorView/AgentEditorView.test.tsx` · Depends on: T2
- Tests: `AgentEditor.test.tsx:55-60` → "AC-CTX-77 has exactly three tabs: Config, Skills, Context"; "AC-CTX-80 tab=context hides Save agent while Config stays mounted"; `AgentEditorView.test.tsx`: "AC-CTX-78 …", "AC-CTX-79 …", "AC-CTX-80 edits survive Config → Context → Config", "AC-CTX-81 … Discard keeps tab=context".
- Checks: [C] · Risks: Config visible under Context if `:38` unchanged; missing hook mocks crash tests. · Commit: C3

### T4 — Shared-cache and server-truth tests (real QueryClient)
- AC: AC-CTX-85, 86, 102, 104 · client · test-writer
- Files: A `…/ContextTab/ContextTab.sync.test.tsx` · Depends on: T3
- Tests: "AC-CTX-85 …", "AC-CTX-86 …", "AC-CTX-102 …", "AC-CTX-104 attach on the Context page shows in the agent tab without reload"; AC-104 part 2: `AgentAttachments.test.tsx`, `ContextView.test.tsx`, skill `ContextTab.test.tsx` unedited and passing.
- Checks: [C] · Commit: C4

— **Gate: user approval for Q19 (T5–T9)** —

### T5 — APPROVAL REQUIRED: `ContextReorderRequest` in both contract copies
- AC: AC-CTX-95, 98, 106 · contracts · Files: M both `platform.ts` copies (after `:372`); the literal `.max(10)` gets a comment tying it to the server `MAX_ATTACHMENTS` (`service.ts:211`) in both copies · Depends on: approval
- Acceptance: AC-106 only addition, byte-identical; AC-98 uuid, ≤ 10, unique. Checks: `cd server && pnpm typecheck` → `cd client && pnpm typecheck` · Commit: C5

### T6 — APPROVAL REQUIRED: `ContextStore.reorderAttachments` (port, Drizzle, in-memory)
- AC: AC-CTX-98, 99, 101 · server · Files: M `server/src/modules/context/{types,repository}.ts`, `server/test/helpers/context-store.ts` · Depends on: T5
- Steps: port `({workspaceId, owner, ownerId, repoId, ids}) → rows | null`; repository: one transaction → shared `lockKey()` → select current ids (workspace + owner + repo) → compare sets → ≤ 10 UPDATEs `order=i+1` whose WHERE repeats id + `workspaceId` + owner column + `repoId` → returned rows come from a RE-SELECT inside the same transaction (ordered by `order`). `deleteAttachment` (`repository.ts:165-177`) stays unlocked on purpose; a detach racing a reorder makes the set stale → next reorder 422 → refetch (AC-97). AC-101 covers reorder/attach and reorder/reorder only. In-memory store same semantics. Plain selects (server INSIGHTS 2026-10-15).
- Checks: [S] · Commit: C6

### T7 — APPROVAL REQUIRED: `ContextService.reorder` + PUT route + route tests
- AC: AC-CTX-98, 99, 100, 106 · server · Files: M `server/src/modules/context/{service,routes}.ts`, `server/test/context-routes.test.ts` · Depends on: T6
- Tests (agents and skills prefixes): "AC-CTX-98 reorder stores order 1..n and returns the new order", "AC-CTX-99 missing/extra/duplicate/unknown/other-owner ids → 422, rows unchanged", "AC-CTX-100 agent or repo of another workspace → 404, rows unchanged".
- Checks: [S] · Commit: C7

### T8 — APPROVAL REQUIRED: run order after reorder
- AC: AC-CTX-103 · server · test-writer · Files: M `server/test/run-executor-context.test.ts` · Depends on: T6
- Test: "AC-CTX-103 after reorder to [b, a] specs and specs_read list b before a". Checks: [S] · Commit: C8

### T9 — APPROVAL REQUIRED: `useReorderContextDocs` + drag/↑↓ controls
- AC: AC-CTX-95, 96, 97, 106 · client · Files: M `client/src/lib/hooks/context.ts`, `ContextTab/{ContextTab.tsx,helpers.ts,styles.ts,ContextTab.test.tsx,helpers.test.ts,ContextTab.sync.test.tsx}`, `client/messages/en/context.json` · Depends on: T4, T5; run after T7 (tests mock `api`; the manual check needs the endpoint). "Pending" for AC-96 includes attach, detach and reorder.
- Tests: "AC-CTX-95 moveBy/dropOn return all ids in the new order", "AC-CTX-96 reorder controls are disabled while filtering or pending", "AC-CTX-95 ↑/↓ and drop send one PUT with all ids in the new order", "AC-CTX-97 failed reorder refetches the server order and shows an error", "AC-CTX-94 not-cloned: attached rows keep reorder controls" (pins A-4).
- Checks: [C] · Risks: jsdom drag via `fireEvent.dragStart/drop`. · Commit: C9

### T10 — Integration test AC-101 (writing: with Q19 approval; running: APPROVAL REQUIRED)
- AC: AC-CTX-101 · server · test-writer · Files: M `server/test/context.it.test.ts` · Depends on: T7
- Test: "AC-CTX-101 concurrent reorder/attach and reorder/reorder keep distinct gap-free orders under the advisory lock".
- Checks (approval only): `cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/context.it.test.ts` · Commit: C10

## AC coverage

| AC-ID | Tasks | Test(s) | Verification |
|---|---|---|---|
| 77 | T3 | AgentEditor.test.tsx | RTL |
| 78, 79, 81 | T3 | AgentEditorView.test.tsx | RTL |
| 80 | T3 | AgentEditor.test.tsx + AgentEditorView.test.tsx | RTL |
| 82, 83, 90 | T2 | ContextTab.test.tsx + helpers.test.ts | RTL/unit |
| 84, 87, 88, 91, 92, 93, 94, 105 | T2 | ContextTab.test.tsx | RTL |
| 89 | T1, T2 | ContextTab.test.tsx | RTL |
| 85, 86, 102 | T4 | ContextTab.sync.test.tsx | RTL |
| 104 | T1, T4 | ContextTab.sync.test.tsx + unedited existing tests | RTL |
| 95 | T5, T9 | helpers.test.ts + ContextTab.sync.test.tsx | RTL/unit |
| 96 | T9 | ContextTab.test.tsx | RTL |
| 97 | T9 | ContextTab.sync.test.tsx | RTL |
| 98 | T5, T6, T7 | context-routes.test.ts | unit |
| 99 | T6, T7 | context-routes.test.ts | unit |
| 100 | T7 | context-routes.test.ts | unit |
| 101 | T6, T10 | context.it.test.ts | integration (approval) |
| 103 | T8 | run-executor-context.test.ts | unit |
| 106 | T5, T7, T9 | — | manual code review |

## Commits (proposed; created only on the user's request)

| Commit | Tasks | Message |
|---|---|---|
| C1 | T1 | refactor(client): move DocPreview to shared context-doc-preview |
| C2 | T2 | feat(client): add agent editor Context tab component |
| C3 | T3 | feat(client): show Context as third agent editor tab |
| C4 | T4 | test(client): cover agent Context tab cache and server truth |
| C5 | T5 | feat(contracts): add ContextReorderRequest to both shared copies |
| C6 | T6 | feat(server): add context attachment reorder to the store |
| C7 | T7 | feat(server): add PUT context-docs/order endpoint |
| C8 | T8 | test(server): pin run doc order after reorder |
| C9 | T9 | feat(client): reorder attached context docs in the agent tab |
| C10 | T10 | test(server): cover concurrent context reorder on Postgres |

## Order

T1 → T2 → T3 → T4 before the Q19 approval. Then approval → T5 → T6 → (T7, T8) → T9 → T10 (written) → approval to run. Package checks never in parallel.

## Final verification

1. `cd client && pnpm typecheck && pnpm test`
2. `cd server && pnpm typecheck`
3. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
4. APPROVAL: `cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/context.it.test.ts`
- Manual (user): `/agents/<id>?tab=context` — attach, reorder, preview.

## For reviewers

- **architecture-reviewer:** reorder service/store split; set check inside the lock; one shared `lockKey()`; local `formatKb` (A-3); ContextTab folder layout; non-optimistic hook (A-1).
- **security-reviewer:** workspace scoping of reorder (owner, repo, UPDATE filtered by workspace + owner + repo); other owner's ids → 422; body bounds (≤ 10, uuid, unique); DocPreview stays read-only after the move.
- **plan-verifier:** every A1 AC maps to an `it("AC-CTX-…")`; AC-106 manual diff review; AC-104 requires three existing test files unedited.

## Unknowns

What the `Tabs` component exposes as active (e.g. `aria-selected`) was not checked; AC-78 asserts tab content instead.
