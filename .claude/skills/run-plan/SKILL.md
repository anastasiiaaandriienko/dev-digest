---
name: run-plan
description: Manual SDD orchestrator for DevDigest. Drives one feature through spec-creator → approved spec → implementation-planner → cross-model plan review → approved plan → implementer → test-writer → architecture-reviewer (+ security-reviewer) → plan-verifier, stopping at every approval gate. Artifacts live in specs/<slug>/ (spec.md, plan.md, verification.md, run-log.md). Invoke explicitly as /run-plan.
argument-hint: "<slug> [feature request…]  |  <slug> --from <spec|plan|review|implement|test|arch|verify>"
disable-model-invocation: true
metadata:
  type: workflow
  scope: client, server, reviewer-core, contracts
---

# run-plan (SDD workflow)

The **main agent** runs this skill and is the only hub: it calls each subagent, relays
questions to the user, and owns every file outside the subagents' write scopes and
all of git. Subagents never call each other. Agent rules live in
`.claude/agents/*.md`; this file only sets the order, the gates and the hand-offs.

Arguments: `$ARGUMENTS` — `<slug>` (kebab-case, e.g. `l05-context-folder`) plus
either the feature request or `--from <stage>` to resume. Empty → ask for the slug
and the request, then stop.

## Gates — hard stops

| Gate | Before | Passes only when |
|---|---|---|
| **G1 Spec** | planning | the user explicitly approves `spec.md` and it has no `[NEEDS CLARIFICATION]` |
| **G2 Plan** | any code change | the user explicitly approves the plan **and** every `APPROVAL REQUIRED` item in it by name |
| **G3 Extra** | the step that needs it | the user approves an unplanned protected action (migration, schema, dependency, lockfile, integration/e2e, paid LLM call) |
| **G4 Commit** | `git commit` | the user asks for the commit; nothing is pushed or merged by this skill |

At a gate: show the artifact summary, ask (AskUserQuestion is fine), then **end the
turn**. Silence, "looks good" about something else, or an approval of an earlier
gate is not an approval. Approval of one gate never covers the next one.

## Artifacts — `specs/<slug>/`

| File | Written by | When |
|---|---|---|
| `spec.md` | spec-creator; main agent sets `Status: Approved (<date>)` | S1, at G1 |
| `plan.md` | main agent (approved plan verbatim + `Status: Approved (<date>)` + review verdict) | at G2 |
| `verification.md` | main agent (plan-verifier report verbatim) | S7 |
| `run-log.md` | main agent, one row per subagent call | every stage |

`run-log.md` feeds `/workflow-retro`:
`| Stage | Agent | Model | Agent ID | Started | Duration ms | Tokens | Tool uses | Result |`
— copy duration, tokens and tool uses from the task notification of each call;
write `UNKNOWN` when a value is not reported. Never estimate.

## Stages

**S1 — spec** · `spec-creator` (prompt: request, target `specs/<slug>/spec.md`,
user answers so far). `NEEDS_CLARIFICATION` → ask the user its questions → run
spec-creator again with the answers. Repeat until `DONE`. → **G1**.

**S2 — plan** · `implementation-planner` (prompt: spec path, constraints, approvals
already known). `SPEC_GAP` → back to S1 with the gap. `BLOCKED` → fix the input.

**S3 — cross-model review** · `implementation-planner` with `MODE: REVIEW`, the spec
path and the draft plan verbatim, on a **different model** than S2 (Agent `model`
override, e.g. `sonnet` when S2 ran on `opus`). Verdict `rework` or any blocker →
S2 again with the findings (at most 2 rounds, then ask the user). Present plan +
review verdict + approvals required → **G2** → save `plan.md`.

**S4 — implement** · `implementer` (prompt: `plan.md` verbatim, task IDs in plan
order, approvals granted at G2/G3). `BLOCKED` → answer or return to the user.
Run dependent tasks sequentially; package checks never in parallel.

**S5 — tests** · `test-writer` for the plan's test tasks and any unit AC whose test
is missing. A test that exposes a defect → back to S4 for that task.

**S6 — review** · build the REVIEW PACKET (`.claude/agents/README.md`: plan,
task IDs, ACs, base ref, changed files, approvals — no author reasoning) and run in
parallel, fresh contexts: `architecture-reviewer`, and `security-reviewer` when the
diff touches untrusted input, prompts, auth/workspace scoping, secrets, raw SQL,
outbound requests or `.claude/**`. Findings → S4 fixes → re-review (at most 2
rounds). `doc-writer` may run after a positive verdict when the plan has doc tasks.

**S7 — verify (last)** · `plan-verifier` with the spec path, `plan.md`, task IDs,
base ref and approvals. Save `verification.md`. Any PARTIAL/MISSING → report the
gaps to the user; do not call the feature done.

**After S7** · show `git status`, the verification summary and the plan's commit
table → **G4**. After commits, re-run `plan-verifier` with the commit range if the
user wants the commit column filled. Then suggest `/workflow-retro <slug>`.

## Rules

- One feature per run. Follow `AGENTS.md` (protected paths, no installs, no paid
  calls, Windows shell notes); this skill grants no extra permission.
- Hand off artifacts verbatim; don't summarise a spec or plan into a subagent prompt.
- Never mark a stage done on a subagent's say-so alone when its report says
  `PARTIAL`, `BLOCKED` or lists failing checks.
- Write artifacts in English.
