---
name: pr-self-review
description: Manual self-review of the uncommitted diff before declaring work complete. Classifies changed files (client/, server/, reviewer-core/, shared contracts, other), loads the matching architecture and stack skills (frontend-architecture + React/Next/RTL for client; onion-architecture + Fastify/Drizzle for server; both for a mixed diff), checks the diff against them and reports findings with severity, file, line, explanation and suggested fix. Read-only — never edits, stages or commits. Invoke explicitly as /pr-self-review.
argument-hint: "[base-ref]  (default: uncommitted changes vs HEAD; e.g. `main` to review the whole branch)"
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Skill, Bash(git status:*), Bash(git diff:*), Bash(git ls-files:*), Bash(git log:*), Bash(git show:*)
metadata:
  type: workflow
  scope: client, server, reviewer-core
---

# PR self-review (workflow)

A dispatcher: it decides **which skills apply** to the current diff, loads them, and reviews
the diff against them. It runs only when invoked by hand (`/pr-self-review`);
`disable-model-invocation: true` stops Claude from starting it on its own, and no git hook
calls it (there is no `.claude/settings.json` hook — keep it that way).

Arguments: `$ARGUMENTS` — optional base ref. Empty → review uncommitted work (staged +
unstaged + untracked) against `HEAD`. A ref such as `main` → review `git diff <ref>...HEAD`
plus uncommitted work.

## Hard rules

- **Read-only.** Never edit, create, delete, stage, unstage, commit, stash or push. Never run
  installs, migrations or seeds. Suggested fixes go in the report only.
- Review only what changed. Pre-existing problems are mentioned only when a changed hunk
  touches them.
- Do not invent line numbers: every finding cites a line read from the diff or the file.

## Step 1 — Collect the diff

```sh
git status --short
git diff HEAD --name-status                 # staged + unstaged vs HEAD
git ls-files --others --exclude-standard    # untracked (new) files
# with a base ref:  git diff <ref>...HEAD --name-status
```

Ignore: lockfiles, `server/clones/**`, build output, and the untracked `*/pnpm-workspace.yaml`
files. If nothing changed, report "No changes to review" and stop.

## Step 2 — Classify files and pick skills

| Changed path | Group | Skills to load |
|---|---|---|
| `client/**` (except `client/src/vendor/shared/**`) | **client** | `frontend-architecture`, `react-best-practices`, `react-testing-library`; add `next-best-practices` when `client/src/app/**` (pages, layouts, routing) changed |
| `server/**` (except `server/src/vendor/shared/**`) | **server** | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`; add `postgresql-table-design` when `server/src/db/schema/**` changed |
| `reviewer-core/**` | **core** | `onion-architecture` (domain purity: no DB, GitHub or FS) |
| `client/src/vendor/shared/**`, `server/src/vendor/shared/**` | **contracts** | `zod`; and check that BOTH copies changed identically |
| anything touching auth, secrets, uploads, user input, raw SQL | **security** (in addition) | `security` |
| docs, `e2e/**`, `.claude/**`, root files | **other** | none — check links, accuracy and the AGENTS.md rules only |

Dispatch:

- **client-only diff** → client skill set.
- **server-only diff** → server skill set.
- **mixed diff** (client + server and/or core) → load **both** sets and review each file
  against the set of its own group; also check the contract between them (DTO shape,
  snake_case fields, both `vendor/shared` copies, query keys invalidated for new endpoints).

Load each selected skill with the **Skill** tool. If a skill cannot be invoked that way, read
its file directly: `.claude/skills/<name>/SKILL.md` (and only the referenced sub-files you
need). Always read the package rules too: `client/AGENTS.md`, `server/AGENTS.md`,
`reviewer-core/AGENTS.md` for the groups present.

## Step 3 — Review

For each changed file, read the diff hunks (`git diff HEAD -- <file>`, or the whole file if
untracked) and check, at minimum:

- **client:** right location (route `_components/` vs `src/components/`), folder convention
  (`Name.tsx`, `index.ts`, `styles.ts` with `s`), data only through `src/lib/hooks/*`, query
  keys and invalidation, strings in `messages/en/*.json`, CSS variables instead of colours,
  co-located test added or updated.
- **server:** route → service → repository/domain; no `container.db` / `container.github()` /
  `container.llm()` / `container.git` added to `routes.ts`; adapters only via `Container`;
  `workspaceId` scoping; `IdParams` on `:id`; `AppError` subclasses; `RunLogger` for run
  events; DB tests named `*.it.test.ts`; no edits under `server/src/db/migrations/**`
  without approval.
- **core:** stays pure; new prompt sections recorded in the trace assembly.
- **everywhere:** tests cover the change; no secrets; no lockfile or `package.json` edits;
  no unrelated changes.

Optional, only if the user agrees (they take time but do not modify sources):
`cd client && pnpm typecheck && pnpm test`, `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`,
`cd reviewer-core && npm run typecheck && npm test`.

## Step 4 — Report

```markdown
## PR self-review — <client | server | core | mixed> diff, <N> files

Skills applied: frontend-architecture, react-best-practices, … (per group)

| # | Severity | File:line | Rule (skill) | Problem | Suggested fix |
|---|---|---|---|---|---|
| 1 | CRITICAL | server/src/modules/x/routes.ts:42 | onion-architecture | Route calls `container.github()` | Move the call into `XService.sync()` and call it from the route |

Verdict: ready to commit | fix CRITICAL/WARNING first
Not reviewed / skipped: <files and why>
```

Severity: **CRITICAL** — breaks a hard rule (layering, migrations/lockfiles, secrets, broken
contract, missing workspace scope) or will break at runtime; **WARNING** — convention or test
gap that should be fixed before commit; **SUGGESTION** — optional improvement. If there are no
findings, say so explicitly and list the skills that were applied.
