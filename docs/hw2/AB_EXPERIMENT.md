# HW2 — API Contract Reviewer A/B experiment (skills off vs on)

**Result:** with its four skills, the API Contract Reviewer found **3 / 3** breaking
changes and raised **no** false positives. Without skills it found **0 / 3**, and its
only finding was a wrong "critical" on the harmless change. The skills added
5,287 input tokens (5,090 of them the skill text) and cost **+$0.00085** per review.

This is one run per arm on one small PR. It is a clear signal, not a statistical result.

## 1. Setup

| | |
|---|---|
| Test PR | [#3](https://github.com/anastasiiaaandriienko/dev-digest/pull/3), **draft, do not merge**, branch `test/api-contract-ab` from `main` `28c84bb` |
| Head SHA (both runs) | `109471f2fdf128531aae4bdd5e036e3748a1cd1c` |
| Diff | 3 files, +8 / −5 (`server/src/modules/agents/{helpers,routes}.ts`, `server/src/vendor/shared/contracts/knowledge.ts`) |
| Agent | API Contract Reviewer `7e185d59-b4f5-4fca-9a88-d98bb4c1ee1c` |
| Model | OpenRouter `deepseek/deepseek-v4-flash` (switched from `openai/gpt-4.1`; agent version 1 → 2) |
| Unchanged | system prompt (md5 `548ef6b6…`, 115 chars), `single-pass`, `repo_intel=true`, `ci_fail_on=critical`, output schema, description |
| Variable | the agent's 4 skill links: **A** all `enabled=false` (same order), **B** all `enabled=true` |
| Skills (order) | `breaking-change` v1 → `response-schema` v1 → `semver-discipline` v1 → `deprecation-policy` v1 |

Only PR #3 was imported into DevDigest, with the same inserts as the PR sync. The
normal list sync would also have imported PR #2. The stored `pr_files` patches are
byte-identical to `git diff 28c84bb...109471f`. The clone does not contain the head
commit, so both runs reviewed exactly these patches.

## 2. Ground truth (fixed before any LLM call)

Full table: [`ab-evidence/ground-truth.md`](ab-evidence/ground-truth.md).

| ID | Change | Breaking? |
|---|---|---|
| GT1 | `Agent` response field `system_prompt` → `instructions` (`helpers.ts:19`, `knowledge.ts:182`) | yes |
| GT2 | `PUT /agents/:id` → `PATCH` (`routes.ts:109`) | yes |
| GT3 | `POST /agents`: `description` optional → required `min(1)` (`routes.ts:35`) | yes |
| DECOY | new optional `created_at` in the `Agent` response (`helpers.ts:26`) | no |

## 3. Controls verified

| Check | A | B |
|---|---|---|
| PR / head SHA | #3 / `109471f` | #3 / `109471f` |
| provider / model (trace `config`) | openrouter / deepseek-v4-flash, agent v2 | same |
| User prompt (diff + repo-intel + description) | md5 `4e4d7cab…` | **identical** md5 `4e4d7cab…` |
| PR description in prompt | neutral one-liner | identical |
| `prompt_assembly.skill_blocks` | `null`, log: *"skills: none applied"* | **4 blocks in the original order**, `skills_tokens = 5090` |
| Structured LLM attempts | 1 | 1 |

The run reports one `review_file` call. Billed `tokens_in` is 1.04–1.06 × the
tiktoken size of system + user prompt, so there was no structured re-prompt. A
re-prompt would resend the whole conversation and roughly double the input. The
OpenRouter SDK's own transport retries (timeout / 429 / 5xx) are **not recorded**
by the app, so they cannot be ruled out from the data.

After the runs, the agent config and its skill links match the post-switch
baseline exactly: same `agent_skills` hash, all four enabled, same order.

## 4. Results

| | A — skills off | B — skills on |
|---|---|---|
| Run id | `e7c00193-954c-4982-b0b0-7170e3462522` | `c7c7a025-27c0-4b6c-ae2e-f56e7624200f` |
| Verdict / score | request_changes / 65 | request_changes / 18 |
| Findings (grounded) | 1 (1/1) | 3 (3/3) |
| **GT1** field rename | ❌ missed | ✅ CRITICAL `helpers.ts:19` |
| **GT2** PUT → PATCH | ❌ missed | ✅ CRITICAL `routes.ts:109` |
| **GT3** required `description` | ❌ missed | ✅ WARNING `routes.ts:35` |
| DECOY flagged | ⚠️ yes: CRITICAL "null pointer on `createdAt`" | no |
| False positives | **1** | **0** |
| Tokens in / out | 3,102 / 2,747 | 8,389 / 3,146 |
| Cost (`usage.cost` from OpenRouter) | **$0.00120** | **$0.00206** |
| Duration | 63 s | 55 s |

**A's only finding is a false positive.** It calls `row.createdAt.toISOString()`
a crash risk, but `agents.created_at` is `NOT NULL`. It also cites `helpers.ts:22`,
while the line is 26.

The pre-registered rule defines a false positive as calling the decoy *breaking*.
This finding instead claims a CRITICAL crash on the decoy. I count it as a false
positive because it reports a defect that does not exist. Under the literal rule,
A would have 0 false positives and still 0 / 3 detections.

**B's findings** name each change as breaking, describe the client impact
("receive `undefined`", "404", "422") and recommend a deprecation step. GT3 is
rated WARNING rather than CRITICAL, which is arguable but still a detection.

Output tokens include the model's reasoning: the visible JSON was 334 tokens in A
and 1,011 in B.

## 5. Cost

| Run | Cost |
|---|---|
| Pilot (excluded, see §6) | $0.00129 |
| A | $0.00120 |
| B | $0.00206 |
| **Total** | **$0.00455** |

The total is below every stop rule: A < $0.02, and the accumulated cost stayed
< $0.05. The $0.10 figure was a spending target; **the app does not enforce any
budget.** Costs are the per-response `usage.cost` reported by OpenRouter. The
key's account-level usage counter had not updated yet when this report was
written (it still showed $0.0496 lifetime), so the costs are not cross-checked there.

## 6. Pilot run — excluded from the A/B results

The pilot is not part of the A/B comparison. It is kept only for transparency.

- **Run:** `4f911c38-b305-4eea-8318-bd676c8c5fa0`, skills off, same SHA and model.
  Evidence: [`ab-evidence/pilot-A-leaked-description.json`](ab-evidence/pilot-A-leaked-description.json).
- **Why it is invalid:** the PR #3 description I first wrote listed the expected
  answers ("breaking" / "decoy"). DevDigest puts the PR description into the
  prompt, and one finding quoted it ("The PR description confirms this is a
  breaking change"). Its user prompt therefore differs from A and B: md5
  `ef9141bc…` vs `4e4d7cab…`.
- **What happened next:** I stopped before running B and reported it. With approval,
  I replaced the PR #3 body with a neutral one-liner (head SHA unchanged) and ran
  the valid A and B above.
- **Its output:** the same false positive on `created_at`, plus a PUT→PATCH remark
  about "data loss" that leaned on the leaked text. Cost $0.00129, which is
  included in the spend total in §5.

## 7. Limitations

- **n = 1 per arm** on a 13-line diff, at temperature 0. Treat it as a signal, not
  a measured rate.
- **Agent version.** Toggling skill links does not create an agent version, so both
  runs show `version: 2`. The trace's `skill_blocks` is the source of truth.
- **No UI screenshots.** The PR pages and the app shell call
  `GET /repos/:id/pulls`, which syncs **all** open PRs into the DB and would have
  imported HW2 PR #2. The evidence is therefore data from the run traces and the DB
  (`ab-evidence/*.json`: run row, findings, stats, `skill_blocks`, prompt hashes,
  live log, raw output).
- **CI on PR #3** may fail typecheck, because `main` lacks `cost.js` / `trace-cost.js`
  (they come with HW2). Server tests that assert `system_prompt` may also fail. This
  does not affect the review, which only reads the diff.

## 8. Development-database changes made by the experiment

- **Added PR #3:** 1 `pull_requests` row (its body later set to the neutral text),
  3 `pr_files` rows and 1 `pr_commits` row.
- **API Contract Reviewer:** provider and model changed (version 2, +1
  `agent_versions` row). Its skill links were toggled off and back on, ending
  identical to before.
- **Review output:** 3 `agent_runs`, 3 `reviews`, 6 `findings` and 3 `run_traces`.
- **Untouched:** General Reviewer, `repo-conventions`, conventions, settings and
  all other data.

## 9. Final state

- The agent is on OpenRouter `deepseek/deepseek-v4-flash`, with all four skills
  enabled in their original order.
- PR #3 is still an open draft; it was not merged.
- PR #2 has not been modified.
