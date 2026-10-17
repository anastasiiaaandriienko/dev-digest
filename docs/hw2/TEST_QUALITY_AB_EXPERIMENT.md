# HW2 — Test Quality Reviewer A/B experiment (skill off vs on)

> **Status: NOT RUN — requires paid LLM calls and writes runs to the DB; awaiting user permission.**
>
> Everything needed to run it is prepared: the agent setup, the control PR, the ground truth
> and a script that runs one arm and saves its evidence. No result below is filled in, and
> nothing in this file is a measured outcome.

Same method as the API Contract Reviewer experiment ([`AB_EXPERIMENT.md`](AB_EXPERIMENT.md)): one
control PR with a pre-registered ground truth, one run per arm, the same agent, model, PR SHA and
prompt; the only variable is the agent's link to the `test-quality` skill.

## 1. Setup

| | |
|---|---|
| Control PR | branch `test/test-quality-ab` from `main`, **draft, do not merge**; content = [`test-quality-ab/fixture/`](test-quality-ab/fixture/) |
| Head SHA (both runs) | _to be filled after the PR is pushed_ |
| Diff | 2 new files, +60 / −0: `server/src/modules/skills/budget.ts`, `server/test/skills-budget.test.ts` (tests pass, happy path only) |
| Agent | **Test Quality Reviewer**, created by `server/src/db/seed-test-quality.ts` (idempotent) |
| Model | OpenRouter `deepseek/deepseek-v4-flash` (same as the API Contract A/B) |
| System prompt | 115 chars, rubric-free: *"You review pull requests for the quality of the tests they add or change. Report only problems visible in the diff."* |
| Unchanged | system prompt, `single-pass`, `repo_intel=true`, `ci_fail_on=critical`, output schema, description |
| Variable | the agent's one skill link: **A** `enabled=false`, **B** `enabled=true` |
| Skill | `test-quality` v1 ([`docs/skills/test-quality-reviewer/test-quality.md`](../skills/test-quality-reviewer/test-quality.md)), type `rubric`, source `imported` |

### Reproducible agent setup

`seedTestQualityReviewer()` (`server/src/db/seed-test-quality.ts`) creates, in the default workspace:

- the skill `test-quality` from the docs file, through the Skills Import parser and its
  case-insensitive name check under the per-workspace import lock; created **disabled** like every
  imported skill, unless `--enable-skill` is passed;
- the agent `Test Quality Reviewer` (version 1 + its `agent_versions` snapshot);
- one link agent → skill (order 0, enabled).

Re-running it creates nothing new and never overwrites user changes (skill body, agent config, link
order or `enabled`); it reports them (`skillBodyMatchesFile`, `linkEnabled`, …). Covered by
`server/test/seed-test-quality.test.ts` (unit) and `server/test/seed-test-quality.it.test.ts`
(Testcontainers, throwaway Postgres).

## 2. Runbook (for the user — every step below writes to the DB the API uses)

1. **Control PR.** From `main`: `git switch -c test/test-quality-ab`, copy
   `docs/hw2/test-quality-ab/fixture/server/**` to `server/**`, commit, push, open a **draft** PR with
   a neutral one-line body (e.g. *"Do not merge — test pull request used for reviewer evaluation."*).
   **Never** describe the expected gaps in the PR body: DevDigest puts the body into the prompt
   (this invalidated the API Contract pilot run).
2. **Import only that PR** into DevDigest (as in the API Contract run; opening the PR list syncs every
   open PR). Check that the stored `pr_files` patches equal `git diff main...<head>`.
3. **Agent.** `cd server && DATABASE_URL=… pnpm exec tsx src/db/seed-test-quality.ts`, then review the
   skill in **Skills** and enable it there (or re-run with `--enable-skill`). Note the printed
   `agentId` / `skillId`.
4. **Dry run (no writes, no LLM):**
   `API=http://localhost:3001 PR_ID=<pr uuid> AGENT_ID=<id> SKILL_ID=<id> ARM=A DRY_RUN=1 node docs/hw2/test-quality-ab/run-arm.mjs`
5. **Arm A, then arm B** (same command without `DRY_RUN`, `ARM=A` then `ARM=B`). Each run is one paid
   call (the API Contract runs cost $0.0012–0.0021 each on this model). The script toggles the link,
   starts the review, waits for it, and writes `docs/hw2/test-quality-ab/ab-evidence/{A-skills-off,B-skills-on}.json`
   with the run row, review, findings (severity, file, lines, rationale), trace stats and config,
   `prompt_assembly.skill_blocks`, `skills_tokens`, prompt hashes, live log and raw output.
6. **Controls** before scoring (fill §3): same head SHA, provider/model and agent version in both
   `trace.config`; identical `user_md5`; identical `system_without_skills_md5`; A has
   `skill_blocks = null` and the log line *"skills: none applied"*; B has one block `test-quality v1`
   and `skills_tokens > 0`; one `review_file` tool call per run.
7. **Score** each finding against [`ground-truth.md`](test-quality-ab/ab-evidence/ground-truth.md) and
   fill §4–§5. Afterwards restore the link to `enabled=true`, close the draft PR, and list the DB rows
   the experiment added (§7).

Stop rule (as before): stop if arm A costs more than $0.02 or the total exceeds $0.05.

## 3. Controls verified

_NOT RUN._

| Check | A | B |
|---|---|---|
| PR / head SHA | — | — |
| provider / model / agent version (trace `config`) | — | — |
| `user_md5` | — | — |
| `system_without_skills_md5` | — | — |
| `prompt_assembly.skill_blocks` | — | — |
| `skills_tokens` | — | — |
| Structured LLM attempts / `review_file` calls | — | — |

## 4. Results

_NOT RUN — requires paid LLM calls and writes runs to the DB; awaiting user permission._

| | A — skill off | B — skill on |
|---|---|---|
| Run id | — | — |
| Verdict / score | — | — |
| Findings (grounded) | — | — |
| **GT1** invalid budget not tested (`budget.ts:15`) | — | — |
| **GT2** budget boundary not tested (`budget.ts:20`) | — | — |
| **GT3** `getBody` rejection not tested (`budget.ts:34`) | — | — |
| **GT4** missing skill → `NotFoundError` not tested (`budget.ts:35`) | — | — |
| **GT5** weak `toBeDefined()` assertion (`skills-budget.test.ts:19`) | — | — |
| DECOY flagged (disabled-skill skip, already tested) | — | — |
| False positives | — | — |
| Severities of the detections | — | — |
| Tokens in / out | — | — |
| `skills_tokens` | — | — |
| Cost (`usage.cost` from OpenRouter) | — | — |
| Duration | — | — |

## 5. Cost

_NOT RUN._ Expected order of magnitude from the API Contract runs on the same model: about $0.001–0.002
per arm; the skill adds roughly its own size in input tokens (the `test-quality` file is ~7.4 KB).

## 6. Limitations (known in advance)

- n = 1 per arm on a ~60-line diff at temperature 0: a signal, not a rate.
- Toggling a skill link does not bump the agent version; the trace's `skill_blocks` is the source of truth.
- `system_without_skills_md5` is computed by removing the Skills block text from the system prompt;
  it is a valid control only if that block appears verbatim in `system` (check once on arm B).
- OpenRouter SDK transport retries are not recorded by the app.

## 7. Development-database changes the experiment will make

- The seed: 1 `skills` + 1 `skill_versions` row, 1 `agents` + 1 `agent_versions` row, 1 `agent_skills` row.
- The PR import: 1 `pull_requests`, 2 `pr_files`, 1+ `pr_commits` rows.
- Each arm: 1 `agent_runs`, 1 `reviews`, N `findings`, 1 `run_traces` row; the link toggle updates
  `agent_skills.enabled`.

None of this has been done yet.
