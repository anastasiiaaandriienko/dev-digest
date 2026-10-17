# Agents

Project subagents for DevDigest. Each agent is one Markdown file in this folder
(YAML frontmatter + system prompt). This README is a map of the set; the rules
themselves live in the agent files — read those, not this page, for details.

| Agent | File | Model | Writes files | Role |
|---|---|---|---|---|
| researcher | [researcher.md](researcher.md) | `sonnet` | no | Facts from the repo and external docs, with evidence |
| brainstorm | [brainstorm.md](brainstorm.md) | `opus` | no | Solution options before planning: approaches, trade-offs, risks, open questions |
| planner | [planner.md](planner.md) | `opus` | no | Requirement → Development Plan (or clarification questions) |
| implementer | [implementer.md](implementer.md) | `sonnet` | yes (plan files) | Executes an approved plan, runs checks, reports |
| test-writer | [test-writer.md](test-writer.md) | `sonnet` | yes (test files only) | Adds/updates unit tests; never changes production code |
| architecture-reviewer | [architecture-reviewer.md](architecture-reviewer.md) | `opus` | no | Layering, dependencies, contracts, coupling — findings with file:line |
| security-reviewer | [security-reviewer.md](security-reviewer.md) | `opus` | no | Exploitable issues and security invariants — findings with file:line |
| plan-verifier | [plan-verifier.md](plan-verifier.md) | `sonnet` | no | Plan criteria → PASS / PARTIAL / MISSING matrix with evidence |
| doc-writer | [doc-writer.md](doc-writer.md) | `sonnet` | yes (docs only) | Updates docs/ and package docs, Mermaid diagrams |

## Workflow

```
user request
   │
   ▼
researcher ──► report (findings, file:line, URLs, Unknowns)
   │
   ▼
brainstorm ──► options + trade-offs + recommendation + open questions
   │           (optional: when there is more than one reasonable approach)
   ▼
main agent asks the user to choose a direction
   │
   ▼
planner ──► NEEDS_CLARIFICATION ──► main agent asks the user ──► planner again
   │
   ▼  STATUS: READY — Development Plan (each task names its agent)
user approves the plan (explicitly)
   │
   ▼
implementer ─┐
test-writer ─┤  the only agents that write code / tests
             ▼
main agent builds a REVIEW PACKET and runs, in parallel, each in a fresh context:
architecture-reviewer · security-reviewer · plan-verifier
             │
             ▼  fixes → implementer again → re-review
doc-writer (after a positive verdict)
             │
             ▼
user (reviews git diff, decides on commit)
```

- Subagents never call each other (`Agent` is denied to all of them). The **main
  agent** is the only hub: it passes reports between agents and asks the user every
  question (subagents cannot ask the user — they return questions in their report).
- Artifacts travel **in prompts**, not files: the approved plan is pasted verbatim
  with the task IDs to run and any extra approvals.
- **REVIEW PACKET** (input of reviewers and plan-verifier): approved plan verbatim,
  task IDs, acceptance criteria, base ref (default: uncommitted work vs `HEAD` incl.
  untracked), changed-file list, approvals granted. It does **not** include the
  implementer's reasoning, self-assessed criteria or deviation arguments — the
  checker must not anchor on the author. Reviewers collect the diff themselves.
- No agent commits, pushes or merges; git is the main agent's job, on the user's
  request.

## researcher

- **Purpose:** answer "is X implemented / where / how", "what does library Y
  support", "what constraints apply to Z" before planning or coding.
  Two modes: project research and external research (official docs first).
- **Tools:** `Read, Grep, Glob, WebSearch, WebFetch`; denied `Write, Edit,
  NotebookEdit, Bash, PowerShell, Agent, Skill`.
- **Run when:** a fact is needed before a decision; it changes nothing.
- **Input → output:** a scoped question → `STATUS: DONE | PARTIAL |
  NEEDS_CLARIFICATION` report: Findings, Evidence (`path:line`), Sources (URLs),
  Unknowns, Limitations, search patterns.
- **Limits:** no git/tests/typecheck; no `localhost`, private addresses or paid APIs;
  "absent" needs a documented search; `WebFetch` returns a summary, not raw text.

## brainstorm

- **Purpose:** explore solution options before planning: 2–4 distinct approaches
  grounded in the current code, compared on trade-offs, risks, effort and project
  rules, with a recommendation and the open questions the user must decide.
- **Tools:** `Read, Grep, Glob, WebSearch, WebFetch`; denied `Write, Edit,
  NotebookEdit, Bash, PowerShell, Agent, Skill`.
- **Run when:** after research, before the planner, when there is more than one
  reasonable way to build something. Skip it for an obvious, single-path change.
- **Input → output:** problem + research report + constraints → `STATUS: DONE |
  PARTIAL | NEEDS_CLARIFICATION` report: constraints, existing building blocks,
  options (where, pros/cons, risks, effort, approvals), comparison table,
  recommendation, open questions for the user, Unknowns, Limitations.
- **Limits:** read-only; no task-level plans, no patches, no implementation; no
  `localhost` or paid APIs; protected areas are listed as `APPROVAL REQUIRED`; it
  cannot ask the user — the main agent relays its open questions.

## planner

- **Purpose:** requirement → small, checkable tasks; knows architecture, protected
  areas, skills, and which agent executes each task.
- **Tools:** `Read, Grep, Glob`; denied `Write, Edit, NotebookEdit, Bash, PowerShell,
  WebFetch, WebSearch, Agent, Skill`. External facts come from researcher reports.
- **Run when:** after research, before a change that spans more than one file or
  package.
- **Input → output:** requirement, research, answers, constraints →
  `NEEDS_CLARIFICATION` (questions with recommended defaults) or `READY` plan: goal,
  scope, assumptions, architecture, approvals, tasks `T1…Tn` (package, agent, files,
  depends on, skills, steps, acceptance criteria, checks, risks), order, final
  verification, notes for architecture-reviewer / security-reviewer / plan-verifier,
  Unknowns, Limitations.
- **Limits:** read-only; named files verified or marked `(new)`; migrations/schema,
  lockfiles, dependencies, paid LLM calls → `APPROVAL REQUIRED`; integration and e2e
  only with approval; does not simulate the reviewers.

## implementer

- **Purpose:** implement approved tasks in `server/`, `client/`, `reviewer-core/`,
  add tests, run checks, self-check the diff.
- **Tools:** `Read, Grep, Glob, Edit, Write, Bash, Skill`; denied `NotebookEdit,
  PowerShell, WebFetch, WebSearch, Agent`. `Bash` is Git Bash on Windows.
- **Run when:** only after the user approved the plan; otherwise `BLOCKED`.
- **Input → output:** approved plan + task IDs + approvals → `DONE | PARTIAL |
  BLOCKED`: changed files per task, checks with real results, criteria evidence,
  deviations, skills, insight candidates, questions, notes for reviewers, limitations.
- **Limits:** without approval — no migrations/schema, lockfiles, deps, installs,
  `db:*`, integration/e2e. Never: git commit/push/merge/reset/stash, app start,
  `localhost`, paid LLM calls, edits outside the plan, `INSIGHTS.md`, `AGENTS.md`,
  `CLAUDE.md`, `.claude/**`. Self-check does **not** replace the reviewers.

## test-writer

- **Purpose:** add or update unit tests for client, server and reviewer-core.
- **Tools:** `Read, Grep, Glob, Edit, Write, Bash, Skill`; denied `NotebookEdit,
  PowerShell, WebFetch, WebSearch, Agent`.
- **Write scope:** `client/src/**/*.test.ts(x)`, `client/src/test/**`,
  `server/test/**`, `reviewer-core/test/**`. Production code is read-only — needed
  changes are returned as suggested diffs.
- **Run when:** after implementation, or for a named coverage gap.
- **Input → output:** plan task IDs or target files/behaviour → `DONE | PARTIAL |
  BLOCKED`: tests added, checks, failing tests that reveal defects (kept, not
  skipped), not covered, needs approval, skills, insight candidates, limitations.
- **Limits:** no `*.it.test.ts` / e2e without approval (they may hit the dev DB and
  real GitHub); same git/app/`localhost`/paid-API bans as implementer.

## architecture-reviewer

- **Purpose:** independent review of layering, dependency direction, both vendored
  contract copies, coupling and naming.
- **Tools:** `Read, Grep, Glob, Bash, Skill`; denied `Write, Edit, NotebookEdit,
  PowerShell, WebFetch, WebSearch, Agent`. Bash: read-only git only.
- **Run when:** after implementer/test-writer, in a fresh context, with a REVIEW PACKET.
- **Output:** `DONE | NEEDS_CONTEXT`: findings table (severity, `file:line`, rule,
  evidence, fix), contract parity (introduced drift only), out-of-plan changes,
  verdict, not reviewed, limitations.
- **Limits:** no edits, builds or tests; only issues affecting correctness,
  requirements or hard project rules; pre-existing issues only if a hunk touches them.

## security-reviewer

- **Purpose:** independent review for exploitable issues and DevDigest security
  invariants (untrusted text → `wrapUntrusted`, `workspaceId` scoping, secrets,
  SSRF, raw SQL, uploads, `.claude/**` changes). Not the product prompt in
  `docs/agent-prompts/security-reviewer.md`.
- **Tools:** `Read, Grep, Glob, Bash, Skill`; denied `Write, Edit, NotebookEdit,
  PowerShell, WebFetch, WebSearch, Agent`. Bash: read-only git only.
- **Run when:** after implementation, in a fresh context, when a diff touches the
  areas above.
- **Output:** `DONE | NEEDS_CONTEXT`: findings table (severity, `file:line`, OWASP
  category / invariant, attack scenario, evidence, fix), areas checked with no
  findings, verdict, not reviewed, limitations.
- **Limits:** never prints secret values; no generic hardening advice.

## plan-verifier

- **Purpose:** map every task and acceptance criterion of the approved plan to the
  code: PASS (code + test/command evidence) / PARTIAL / MISSING (after a documented
  search).
- **Tools:** `Read, Grep, Glob, Bash`; denied `Write, Edit, NotebookEdit,
  PowerShell, WebFetch, WebSearch, Agent, Skill`. Bash: read-only git + the three
  unit gates from root `AGENTS.md`, only when the plan lists them.
- **Run when:** after implementer/test-writer, in a fresh context, with a REVIEW PACKET.
- **Output:** `DONE | BLOCKED`: matrix `Task | Criterion | Status | Evidence | Note`,
  checks run, out-of-plan changes, protected paths, summary counts, verdict,
  limitations.
- **Limits:** no edits; integration/e2e only with approval.

## doc-writer

- **Purpose:** update documentation after a verified change, following the existing
  structure and `AGENTS.md` "Read When" routing; Mermaid diagrams where useful.
- **Tools:** `Read, Grep, Glob, Edit, Write`; denied `Bash, PowerShell, NotebookEdit,
  WebFetch, WebSearch, Agent, Skill`.
- **Write scope:** `docs/**`, `server/docs/**`, `client/docs/**`,
  `reviewer-core/docs/**`, `e2e/docs/**`, package `README.md`. With approval:
  `*/specs/**`, root `README.md`, `TESTING.md`. Never `AGENTS.md`, `CLAUDE.md`,
  `INSIGHTS.md`, `.claude/**`, code or tests — routing edits are proposed as text.
- **Run when:** after plan-verifier and reviewers gave a positive verdict.
- **Output:** `DONE | PARTIAL | BLOCKED`: changed docs, diagrams, proposed routing
  edits, claims verified (`path:line`), limitations (rendering not checked).

## Skills and INSIGHTS.md

- **Skills** live in [../skills/](../skills/README.md). Agents name them; they never
  copy skill text, and no agent preloads skills via the `skills` frontmatter field.
  - researcher, brainstorm, plan-verifier: no skills.
  - planner: names the skills per task (skill map in [planner.md](planner.md)).
  - implementer, test-writer, architecture-reviewer, security-reviewer: load skills on
    demand with the `Skill` tool. Package mapping: client → `frontend-architecture`
    (+ `react-best-practices`, `react-testing-library`, `next-best-practices`);
    server → `onion-architecture` (+ `fastify-best-practices`,
    `drizzle-orm-patterns`); reviewer-core → `typescript-expert`, and
    `onion-architecture` for purity (planner, implementer, test-writer,
    architecture-reviewer);
    contracts → `zod`; untrusted input → `security`.
  - architecture-reviewer and security-reviewer reuse the group → skills table from
    `pr-self-review` by reference.
  - doc-writer: reads `mermaid-diagram/SKILL.md` (no Skill tool).
  - `pr-self-review` is manual-only (`disable-model-invocation`); the user runs
    `/pr-self-review`, agents cannot.
- **INSIGHTS.md** (today `server/` and `client/`): researcher and planner read the
  touched packages' files and re-verify entries; implementer and test-writer read them
  via `engineering-insights` (read mode) before editing a package. No agent writes
  `INSIGHTS.md`: agents return *insight candidates*, and recording them
  (`/engineering-insights record`) is the user's and main agent's decision.

## Safety layers

| Layer | Enforced by | What it covers |
|---|---|---|
| `tools` / `disallowedTools` | Claude Code | Which tools an agent has at all (researcher, brainstorm, planner, reviewers, plan-verifier: no write tools; doc-writer: no Bash) |
| `permissions.deny` in [../settings.json](../settings.json) | Claude Code | `WebFetch` to `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]` — for main session and subagents |
| Agent prompt rules | the model only | Everything else: write scopes of implementer / test-writer / doc-writer, read-only git for reviewers, no commit / install / migrations / lockfiles / app start |

Write scopes and Bash allowlists are **prompt-level only** today. Bash/Edit deny
rules were researched but not added: per the docs, Bash deny rules are not a security
boundary (e.g. `git -C . push` bypasses `Bash(git push *)`), `Write(path)` rules are
never checked, and files written by subprocesses (`pnpm install`, `drizzle-kit`) are
not covered by `Edit(path)` rules. A `PreToolUse` hook for test-writer was planned as
an optional, approval-gated step and is not in place. Review `git status` /
`git diff` after every run of a writing agent.

## Official sources

- Subagents — frontmatter, tool allow/deny order, fresh context, no
  `AskUserQuestion`, chaining through the main agent, skills in subagents:
  https://code.claude.com/docs/en/sub-agents
- Skills — progressive disclosure, don't duplicate content,
  `disable-model-invocation`: https://code.claude.com/docs/en/skills
- Best practices — explore → plan → implement → verify, self-contained plans with
  checks, verifier ≠ author, fresh-context review, report only what matters:
  https://code.claude.com/docs/en/best-practices
- Model choice — Opus for planning and judgement, Sonnet for execution (`opusplan`):
  https://code.claude.com/docs/en/model-config
- Permission rules and their limits: https://code.claude.com/docs/en/permissions

| Agent | Based on |
|---|---|
| planner, brainstorm | sub-agents, best-practices, model-config, skills |
| implementer, test-writer | sub-agents, skills, best-practices, model-config, permissions |
| architecture-reviewer, security-reviewer, plan-verifier | sub-agents, best-practices (verifier ≠ author, fresh context, no noise), model-config |
| doc-writer | sub-agents, skills |

## Adding an agent

Create `<name>.md` here with at least `name` and `description` (quote the
description if it contains `: `; double an apostrophe inside single quotes), give it
the narrowest `tools`, add it to the table above, and keep the prompt free of absolute
machine paths. A new agent file is picked up by a new session.
