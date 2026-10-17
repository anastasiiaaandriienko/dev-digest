# A/B ground truth — control PR `test/test-quality-ab` (fixed before any LLM review)

Control PR content: [`../fixture/`](../fixture/) — copy it onto a branch from `main` (see
[`../../TEST_QUALITY_AB_EXPERIMENT.md`](../../TEST_QUALITY_AB_EXPERIMENT.md) §2). Diff: 2 new files,
server only: `server/src/modules/skills/budget.ts` (+39) and `server/test/skills-budget.test.ts` (+21).
The tests pass and typecheck, and they cover **only the happy path**.

Line numbers are of the new files.

| ID | Code under test (file:line) | What is not tested | Missing case a test should use | Rubric rule |
|---|---|---|---|---|
| GT1 | `budget.ts:15` `if (!Number.isInteger(budget) \|\| budget <= 0) throw new RangeError` | the guard — no invalid budget is ever passed | `fitSkillsToBudget(skills, 0)`, `-1`, `1.5` throw `RangeError` | missing negative cases |
| GT2 | `budget.ts:20` `if (used + s.tokens > budget) continue` | the budget limit — the only test uses 10 tokens of 100 | exactly at the limit (`tokens === budget`) is kept, `budget + 1` is skipped, and a later smaller skill still fits after a skipped one | missing boundary values / happy path only |
| GT3 | `budget.ts:34` `await repo.getBody(id)` | rejection of the dependency | `getBody` rejects → `await expect(loadSkillBodies(...)).rejects` with that error | async rejection not tested |
| GT4 | `budget.ts:35` `if (body === undefined) throw new NotFoundError` | the missing-skill branch | `getBody` resolves `undefined` → rejects with `NotFoundError` (404) | missing negative cases |
| GT5 | `skills-budget.test.ts:19` `expect(bodies).toBeDefined()` | the result is never checked; a wrong or empty map passes | `expect(bodies).toEqual(new Map([['a', '# x']]))`, `getBody` called with `'a'` | weak assertions |
| DECOY | `budget.ts:19` `if (!s.enabled) continue` | **already tested** — skill `b` (`enabled: false`) is dropped and the test checks `['a']` | — | — |

Scoring rules (decided before the runs):

- **Detected** = a finding points at the GT location (right file and the right branch / line ±2, or
  the named function + behaviour) and says that case is not tested or the assertion is too weak.
  One finding may detect several GTs if it names each of them explicitly.
- **False positive** = a finding says the DECOY (disabled-skill skip) is untested, or reports a test
  gap that is not in the diff (e.g. code the PR does not change).
- **Neutral** = valid remarks that are not about GT1–GT5 (naming, `it.each` style, file layout,
  "add more tests" without a concrete case). Listed, not scored.
- Severity is recorded but not scored. Expected by the rubric: WARNING or SUGGESTION for GT1–GT5
  (none of them is a broken test that hides failures, so CRITICAL would be over-rated).
