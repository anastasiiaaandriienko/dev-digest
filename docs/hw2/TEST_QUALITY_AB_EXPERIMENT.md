# HW2 — Test Quality Reviewer A/B experiment (skill off vs on)

> **Status: RUN on 2026-10-17** — one run per arm on draft PR
> [#5](https://github.com/anastasiiaaandriienko/dev-digest/pull/5), same agent, model, head SHA and
> user prompt. Every number below comes from the run evidence
> ([`A-skills-off.json`](test-quality-ab/ab-evidence/A-skills-off.json),
> [`B-skills-on.json`](test-quality-ab/ab-evidence/B-skills-on.json)) and the pre-registered
> [`ground-truth.md`](test-quality-ab/ab-evidence/ground-truth.md).
>
> **Outcome in one line:** recall is the **same — 4/5 GT in both arms, GT3 missed by both**. The skill did
> not find more problems; it made B's findings narrower and better targeted, for +1854 skills tokens and
> +$0.000098 per run.

Same method as the API Contract Reviewer experiment ([`AB_EXPERIMENT.md`](AB_EXPERIMENT.md)): one
control PR with a pre-registered ground truth, one run per arm, the same agent, model, PR SHA and
prompt; the only variable is the agent's link to the `test-quality` skill.

## 1. Setup

| | |
|---|---|
| Control PR | [#5](https://github.com/anastasiiaaandriienko/dev-digest/pull/5), branch `test/test-quality-ab` from `main` `c6c71ad`, **draft, do not merge**; content = [`test-quality-ab/fixture/`](test-quality-ab/fixture/) |
| PR description | *"Do not merge — test pull request used for reviewer evaluation."* (neutral; the expected gaps are not mentioned) |
| Head SHA (both runs) | `960fa5a64afa9e847a333dd2e5dfc3645828fcce` |
| Diff | 2 new files, +60 / −0: `server/src/modules/skills/budget.ts` (+39), `server/test/skills-budget.test.ts` (+21) (tests pass, happy path only) |
| Agent | **Test Quality Reviewer** `5b50ff0b-325b-438a-84f3-fbdf85ce9d6e`, version 1, created by `server/src/db/seed-test-quality.ts` |
| Model | OpenRouter `deepseek/deepseek-v4-flash` (same as the API Contract A/B) |
| System prompt | 115 chars, rubric-free: *"You review pull requests for the quality of the tests they add or change. Report only problems visible in the diff."* |
| Unchanged | system prompt, `single-pass`, `repo_intel=true`, `ci_fail_on=critical`, output schema, description, PR intent |
| Variable | the agent's one skill link: **A** `enabled=false`, **B** `enabled=true` |
| Skill | `test-quality` v1 `799c14e2-3e94-4c3e-b883-3fd1e615e0e5` ([`docs/skills/test-quality-reviewer/test-quality.md`](../skills/test-quality-reviewer/test-quality.md)), type `rubric`, source `imported` |

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

## 2. What was done

1. **Control PR.** Branch `test/test-quality-ab` created from `main` in an isolated git worktree with
   only the two fixture files (commit `960fa5a`), pushed alone, and opened as draft PR #5 via the
   GitHub REST API.
2. **Backup + migration.** `pg_dump -Fc` of the development DB (validated with `pg_restore --list`),
   then migration `0013` applied (`pr_intent.context_sources`).
3. **Import of PR #5 only** (`pull_requests` id `886a7a27-aba3-4867-9a15-3d9ebb56a42c`), with the same
   inserts as the PR sync and `GET /pulls/:id`; no list sync, so no other PR was touched. The stored
   `pr_files` patches are byte-identical to `git diff c6c71ad...960fa5a`.
4. **Agent.** `seed-test-quality.ts --enable-skill` → skill, agent, link created; no duplicates.
5. **Dry run** of both arms (`DRY_RUN=1`: reads only).
6. **Arm A, then arm B** with [`run-arm.mjs`](test-quality-ab/run-arm.mjs) — one review run each; the
   script toggled the link, started the review, waited for it and saved the evidence. After B the link
   is `enabled=true`.

To repeat a run (after steps 1–4):

- Dry run: `API=http://localhost:3001 PR_ID=<pr uuid> AGENT_ID=<id> SKILL_ID=<id> ARM=A DRY_RUN=1 node docs/hw2/test-quality-ab/run-arm.mjs`
- Real run: the same command without `DRY_RUN`, `ARM=A` then `ARM=B` (each is one paid call).

## 3. Controls verified

| Check | A | B | Equal? |
|---|---|---|---|
| PR / head SHA | #5 / `960fa5a…` | #5 / `960fa5a…` | ✓ |
| provider / model / agent version (trace `config`) | openrouter / `deepseek/deepseek-v4-flash` / 1 | openrouter / `deepseek/deepseek-v4-flash` / 1 | ✓ |
| `user_md5` (diff + repo-intel + description + PR intent) | `b9909e905e9720b57b4c8c42a984d1ea` (9521 chars) | `b9909e905e9720b57b4c8c42a984d1ea` (9521 chars) | ✓ |
| PR intent in the prompt | generated before A (`confidence=medium`, policy `inform`) | `reused stored intent (no model call)` | ✓ same block |
| `system_md5` | `5bce18e4…` (1681 chars) | `57742d40…` (9066 chars) | differs by the Skills block only — see note |
| `system_without_skills_md5` | `5bce18e4fa652e6c10e2e8f73ac095c6` | `ac042498d42a9fbb9a861919cd31760a` | see note |
| `prompt_assembly.skill_blocks` | `null`; log *"skills: none applied"* | `test-quality` v1, order 0, 1781 tokens; log *"skills: applied 1 — test-quality v1 (1854 tokens)"* | expected difference |
| `skills_tokens` | not set (`null` = no Skills section) | **1854** | expected difference |
| Structured LLM calls / `review_file` calls | 1 / 1 (single-pass, all files) | 1 / 1 (single-pass, all files) | ✓ |
| Run status / grounding | `done` / 3/3 passed | `done` / 4/4 passed | ✓ |

**Note on `system_without_skills_md5`.** The script removes the Skills block text from B's system prompt.
The block (7383 chars) appears verbatim in B's `system` (1681 + 7383 + 2 = 9066). What remains differs
from A's prompt only by one extra `\n\n` left where the block was (1683 vs 1681 chars), so the two hashes
differ. After collapsing runs of blank lines the two system prompts are identical. This was checked on the
full prompts from `GET /runs/:id/trace` (the evidence files keep hashes and lengths, not the full text).
This is the limitation listed in advance in §6; the system prompts differ only by the skill.

## 4. Results

| | A — skill off | B — skill on |
|---|---|---|
| Run id | `385d6938-22c3-46c6-a7c8-0a4e26c676db` | `a0399001-7999-4cff-81f7-9768a1905ee2` |
| Review id | `52bb076f-295b-4013-b5de-d3ee021029d1` | `5f5c152d-eeec-49ba-bbeb-b27c2ce51210` |
| Verdict / score / blockers | `request_changes` / 64 / 0 | `request_changes` / 70 / 0 |
| Findings (grounded) | 3 (3/3 passed) | 4 (4/4 passed) |
| **GT1** invalid budget not tested (`budget.ts:15`) | ✅ A#2 | ✅ B#2 |
| **GT2** budget boundary not tested (`budget.ts:20`) | ✅ A#2 | ✅ B#1 |
| **GT3** `getBody` rejection not tested (`budget.ts:34`) | ❌ | ❌ |
| **GT4** missing skill → `NotFoundError` not tested (`budget.ts:35`) | ✅ A#3 | ✅ B#3 |
| **GT5** weak `toBeDefined()` assertion (`skills-budget.test.ts:19`) | ✅ A#3 | ✅ B#4 |
| **Recall (GT detected)** | **4/5** | **4/5** |
| DECOY flagged (disabled-skill skip, already tested) | no | no |
| False positives | 0 | 0 |
| Neutral (not scored) | 1 — A#1 | 0 |
| Severities | WARNING 3 | WARNING 2, SUGGESTION 2 |
| Tokens in / out | 4177 / 3166 | 6083 / 4931 |
| `skills_tokens` | — | 1854 |
| Cost (`usage.cost` from OpenRouter) | $0.00018979 | $0.00028797 |
| Duration | 33.0 s | 49.9 s |

### Findings and how they were scored

**A — skill off**

| # | Severity / category | Location | Finding (title) | Scored as |
|---|---|---|---|---|
| A#1 | WARNING / bug | `budget.ts:14-27` | *fitSkillsToBudget does not validate that skill tokens are non-negative integers* | **Neutral** — a remark on the production code, not a test gap; not GT1–GT5, not the DECOY |
| A#2 | WARNING / test | `skills-budget.test.ts:7-16` | *Test for fitSkillsToBudget does not exercise the budget limit logic* — names "skills that exceed the budget, later smaller skills that still fit after a skipped larger one, … budget exactly equal to used tokens, invalid budget (non-positive or non-integer)" | **GT2** and **GT1** (each named explicitly) |
| A#3 | WARNING / test | `skills-budget.test.ts:18-21` | *Test for loadSkillBodies only checks that the result is defined* — "there is no test for the NotFoundError case when `repo.getBody` returns undefined" | **GT5** and **GT4** (each named explicitly) |

**B — skill on**

| # | Severity / category | Location | Finding (title) | Scored as |
|---|---|---|---|---|
| B#1 | SUGGESTION / test | `budget.ts:20-21` | *Missing test for skip-and-fit logic in fitSkillsToBudget* — big skill skipped, smaller one fits | **GT2** (does not mention the exactly-at-limit case) |
| B#2 | WARNING / test | `budget.ts:14` | *Untested input validation in fitSkillsToBudget* — budget = 0, -1, 1.5 → `RangeError` | **GT1** (line 14 vs GT line 15, within ±2) |
| B#3 | WARNING / test | `budget.ts:35` | *Untested error path in loadSkillBodies* — `getBody` returns `undefined` → `NotFoundError` | **GT4** |
| B#4 | SUGGESTION / test | `skills-budget.test.ts:19` | *Weak assertion in loadSkillBodies test* | **GT5** |

GT3 (a rejected `getBody` promise) is not mentioned by any finding in either run. The word "rejects" in
B#3's suggestion is the Vitest matcher for the `NotFoundError` case (GT4, `getBody` resolves `undefined`),
not a test for `getBody` itself rejecting.

### Interpretation

- **Recall is the same: 4/5 in both arms, and both missed GT3.** In this run the skill did **not**
  increase the number of detected problems. GT3 is an async-rejection case, which the rubric names
  explicitly, and B still missed it.
- **What differs is the quality of the findings, not their count:**
  - every B finding covers exactly one GT, points at the GT's code line or within ±2 of it
    (`budget.ts:14`, `:20-21`, `:35`, `skills-budget.test.ts:19`) and comes with a concrete test case to
    add; A's GT findings point at the test file's line ranges and each covers two GTs;
  - B has no off-topic finding, while one of A's three findings (A#1) is a production-code remark
    filed as `bug`, outside the reviewer's test-quality scope;
  - severities of both arms are within what the ground truth expects ("WARNING or SUGGESTION for
    GT1–GT5", no CRITICAL): A rated all three findings WARNING, B rated two WARNING and two SUGGESTION.
    Severity is recorded but not scored.
- **Where A is not worse:** A groups several GTs into broader findings, and its GT2 finding (A#2) is more
  complete than B's (it also names the exactly-at-limit case that B#1 does not).
- **Cost of the skill:** +1854 `skills_tokens` (the Skills section; the skill block itself is 1781 tokens).
  Input tokens grow by 1906 (6083 vs 4177). The run costs +$0.00009817 (+52 %: $0.00028797 vs
  $0.00018979) and takes 16.9 s longer.
- **Limit:** one run per arm (n = 1), so these differences are a signal, not a measured rate.

## 5. Cost

| Call | Model | Tokens in / out | Cost (OpenRouter `usage.cost`) |
|---|---|---|---|
| PR intent (generated once, before arm A; reused by B) | `openai/gpt-4o-mini` | 600 / 63 | $0.0001278 |
| Arm A review | `deepseek/deepseek-v4-flash` | 4177 / 3166 | $0.00018979 |
| Arm B review | `deepseek/deepseek-v4-flash` | 6083 / 4931 | $0.00028797 |
| **Total** | | | **$0.00060556** |

Costs are the per-response `usage.cost` reported by OpenRouter and summed by the provider adapter
(`reviewer-core/src/llm/openrouter.ts`); the intent cost is from the run log of arm A ("intent: generated —
cost 0.0001278 billed separately") and `pr_intent.cost_usd`. Budget rule: stop if arm A costs more than
$0.02 or the total exceeds $0.05 — not reached.

## 6. Limitations

- **n = 1 per arm** on a 60-line diff at temperature 0: a signal, not a rate. A second run of either arm
  could detect GT3 or miss another GT.
- Scoring is manual against the pre-registered rules in `ground-truth.md`. A#2 and A#3 each count for two
  GTs because they name both cases explicitly, as the rule allows.
- Toggling a skill link does not bump the agent version (both runs report version 1); the trace's
  `skill_blocks` is the source of truth for what was applied.
- `system_without_skills_md5` is computed by removing the Skills block text from the system prompt. It
  differs by one leftover `\n\n` (see the note in §3); equality was confirmed on the full prompts.
- Both prompts include the same PR intent block (generated by `openai/gpt-4o-mini` before arm A). It is a
  constant of the experiment (`user_md5` equal), not a variable.
- OpenRouter SDK transport retries are not recorded by the app.

## 7. Development-database changes made by the experiment

- Migration `0013` applied (adds nullable `pr_intent.context_sources`); a `pg_dump` backup was taken
  before (outside the repository).
- The seed: 1 `skills` + 1 `skill_versions` row, 1 `agents` + 1 `agent_versions` row, 1 `agent_skills` row
  (`enabled=true` at the end).
- The import of PR #5: 1 `pull_requests`, 2 `pr_files`, 1 `pr_commits` row.
- The runs: 2 `agent_runs` (`done`, `done`), 2 `reviews`, 7 `findings` (3 + 4), 2 `run_traces`, and 1
  `pr_intent` row (the generated intent). The link toggle updated `agent_skills.enabled` (false for A,
  true for B).
