# Workflow retro ledger

Append-only log of `/workflow-retro` results for SDD runs (`/run-plan`). One entry
per retro, newest last. Every number comes from
`.claude/skills/workflow-retro/scripts/retro-metrics.mjs`, `specs/<slug>/run-log.md`
or a quoted task notification; unmeasured values are `UNKNOWN`. Entries hold
aggregates only — no prompts, code or command output. Entry format:
[`.claude/skills/workflow-retro/SKILL.md`](../../.claude/skills/workflow-retro/SKILL.md) § Step 4.

<!-- Entries below this line. -->

## 2026-10-18 — project-context-folder (normal)
- Session: 239b1ab8-8ad6-4e6c-b564-3c04e01d2418 · Window: 2026-10-18T06:33:07Z → 2026-10-18T11:38:05Z (whole session; `run-log.md` has no start times, so the window also covers the pre-SDD audit, HW-04 fixes and Stage 1 setup) · Outcome: PASS 75 / PARTIAL 0 / MISSING 1 (AC-CTX-68, paid manual run not approved); 27 commits on `feature/hw-05` after 0a14b4f

| Metric | Value | Source |
|---|---|---|
| Processed tokens (main, per model) | claude-opus-5-5: 240 calls · in 528 · out 231,057 · cache write 536,043 · cache read 51,636,601 | retro-metrics |
| Cache hit ratio | 0.99 | retro-metrics |
| Tool calls / errors | 240 / 2 (Bash 163/1, Edit 29/0, Agent 21/0, Write 13/0, Read 5/0, SendMessage 3/0, ToolSearch 2/0, PowerShell 2/0, Skill 2/1) | retro-metrics |
| Turn time | 8,331,890 ms over 45 turns | retro-metrics |
| Subagents / max concurrency / nested | 21 (18 for this slug + 3 pre-SDD Explore audits) / 3 / 0 | retro-metrics |
| Subagent tokens (notifications) | 2,088,529 over 21 logged calls; 1 row (main-agent e2e work) UNKNOWN | run-log.md |
| Rework rounds (S3 / S6) | S3: 1 review (approve with changes, 8 findings) + 1 SPEC_GAP loop S2→S1 (AC-CTX-46); S6: 0 fix loops (2 + 1 follow-up review, all approve) | run-log.md |

### Findings (verified)
- The spec stage took 4 spec-creator calls: 2 clarification rounds (Q1–Q15, then Q16) and 1 SPEC_GAP revision after planning. The gap (AC-CTX-46 needed a review run in e2e, which `e2e/CLAUDE.md` forbids and the seed could not support) was found by the planner, not the spec author — evidence: run-log S1 ×4, S2 row "SPEC_GAP (AC-CTX-46)".
- The largest subagents by processed tokens were the client implementer T10–T13 (4,853,047; 85 tool calls), implementation-planner across PLAN + final revision (3,564,145; 76 tool calls) and the T15 fixtures implementer (2,721,805; 75 tool calls) — evidence: retro-metrics subagent list.
- Wall-clock durations of resumed subagents include idle time between resumes (spec-creator 2,793,344 ms vs 469,733 ms summed across its notifications), so retro-metrics duration is not work time for SendMessage-resumed agents — evidence: retro-metrics vs run-log.
- The integration run (T14) caught a real concurrency defect (duplicate attachment `order` under concurrent inserts) that the S3 cross-model review and both S6 reviews did not flag as a defect; one implementer call fixed it — evidence: run-log S5 "PARTIAL 7/8", S4 "fix f5c2ce4".
- T15d needed three `./scripts/e2e.sh` runs plus a manual debug stack: (1) `pnpm db:migrate` silently skipped on Windows — already documented in `server/INSIGHTS.md` (2026-10-15) but not pre-checked; (2) `spawn agent-browser ENOENT` with the npm `.cmd` shim; (3) flow-08 race and covered-click — evidence: run-log T15d row, commits c606811, 2a6de14.
- Max concurrency 3 occurred only in S6 (architecture + security in parallel); S4 batches ran strictly serially by design (no parallel package commands) — evidence: retro-metrics concurrency, run-log order.
- One Skill error: `/run-plan` is user-invoked only (`disable-model-invocation`), so the hand-off required a user turn — evidence: retro-metrics Skill 2/1.

### Optimizations (proposed)
- Have spec-creator check the e2e and seed constraints (`e2e/CLAUDE.md`, `server/src/db/seed.ts`) for every `e2e`-verified AC before returning READY — avoids one S1→S2→S1 loop — evidence: SPEC_GAP on AC-CTX-46.
- Add a pre-flight step to `/run-plan` before any approved migrate/e2e step: read the package `INSIGHTS.md` "What Doesn't Work" entries and verify `✓ migrations applied`, plus `AGENT_BROWSER_BIN` on Windows — avoids the failed e2e runs — evidence: T15d runs 1–2.
- Put the concurrency integration test (parallel attaches/roots saves) into the plan's T14 from the start and ask reviewers to treat `max+1` without a lock as a defect — evidence: defect found only at T14.
- Split large client tasks (T10–T13 in one call, 4.85M processed tokens) into two implementer calls (page + hooks; attachments + trace) so each context stays smaller — evidence: retro-metrics subagent list.
- Record `Started` timestamps in `run-log.md` from each task notification so retro-metrics can window the slug precisely instead of the whole session — evidence: all `Started` = UNKNOWN.

### UNKNOWN
- Per-stage main-agent tokens: the main session also contains the audit, HW-04 fixes and Stage 1 work, and `run-log.md` has no start times, so main tokens cannot be split by stage.
- Duration and tokens of the main agent's T15d e2e work (no notification; logged as UNKNOWN).
- Deep mode not run (per-subagent tool latency and repeats).
