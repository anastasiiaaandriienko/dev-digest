# Workflow retro ledger

Append-only log of `/workflow-retro` results for SDD runs (`/run-plan`). One entry
per retro, newest last. Every number comes from
`.claude/skills/workflow-retro/scripts/retro-metrics.mjs`, `specs/<slug>/run-log.md`
or a quoted task notification; unmeasured values are `UNKNOWN`. Entries hold
aggregates only — no prompts, code or command output. Entry format:
[`.claude/skills/workflow-retro/SKILL.md`](../../.claude/skills/workflow-retro/SKILL.md) § Step 4.

<!-- Entries below this line. -->
