---
name: test-quality
description: Flag tests that only cover the happy path - missing negative cases, boundary values, error and async-rejection paths, weak assertions and mocks that hide real behaviour.
type: rubric
---

# Test quality

You review the **tests a pull request adds or changes**, next to the code they test. Your question
is: *if the code under test were wrong, would these tests fail?* A test suite that only exercises
the happy path passes for many broken implementations. Compare each changed function's branches,
inputs and failure modes with the cases its tests actually check, and report what is missing.

Only judge behaviour that is **visible in the diff**: a branch, a `throw`, a guard, a boundary in a
condition, an `await` that can reject. Point at the line in the code under test that is not covered.

## Report it when the diff does any of these

1. **Happy path only** - a new or changed function has branches (`if`, `switch`, early `return`,
   ternary, `??` fallback) and the tests exercise only one of them.
2. **Missing negative cases** - the code rejects input (`throw`, returns an error, `ValidationError`,
   a Zod `.parse` that can fail, `422`) and no test sends invalid input and checks the rejection.
3. **Missing boundary values** - a condition compares against a limit (`percent > 100`, `items.length
   === 0`, `size <= MAX`, an off-by-one index) and no test uses the value exactly at, just below and
   just above the limit, or the empty / zero / maximum case.
4. **Untested error handling** - a `try/catch`, fallback, retry or cleanup path (`finally`, rollback)
   is added and no test makes the dependency fail to reach it.
5. **Async rejection not tested** - an `async` function `await`s something that can reject (DB, HTTP,
   LLM, file system) and no test makes it reject and asserts the outcome (`await expect(...).rejects`,
   the returned error, the failed status). Also report a missing `await` on `expect(...).rejects`,
   which makes the test pass without checking anything.
6. **Weak assertions** - the test only checks that nothing threw, that a value is truthy or defined,
   `toHaveBeenCalled()` without arguments, a snapshot of a large object, or `length` without contents,
   so a wrong result would still pass.
7. **Mocks that hide the behaviour under test** - the unit being tested is itself mocked; a mock
   always returns success so failure paths are unreachable; a mocked return value is asserted back
   (the test checks the mock, not the code); or time, randomness or the network leaks into the test
   so it can pass by accident.

## Do NOT report

- Code the PR does not change, or branches that already have a test in the diff or in a test file
  the diff shows.
- Trivial code with no logic: plain re-exports, type-only changes, constants, simple getters, DTO
  mappers that copy fields one to one.
- Generated files, migrations, fixtures, snapshots updated mechanically, and test helpers.
- A missing test for behaviour a framework guarantees (Zod rejecting a wrong type, Fastify returning
  404 for an unknown route) - unless the PR adds custom logic on top of it.
- Style preferences: test naming, `it` vs `test`, file layout, number of assertions per test.
- A demand for 100% coverage. Report the cases that would catch a **realistic bug**, at most the
  three most important per function.
- Anything you cannot point to in the diff.

## Evidence (required for every finding)

- **file + line** of the untested branch, guard or `await` in the code under test, and the test file
  (and line) that should cover it.
- **Affected contract**: the function or route and the behaviour that is not checked
  (`applyDiscount` - `percent > 100` throws).
- **Missing case**: the concrete input and expected outcome a test should use
  (`applyDiscount(100, 101)` throws `RangeError`).
- **Impact**: which realistic bug would ship unnoticed (`a refactor that drops the guard still passes`).

Severity: **WARNING** for an untested error, rejection or boundary path in production code that
handles money, auth, data loss or external input; **SUGGESTION** for other missing cases and weak
assertions; **CRITICAL** only when a test is broken in a way that hides failures (a missing `await` on
`rejects`, an assertion that can never fail, the unit under test mocked away). Category: `test`.

## Examples

**Code under test** used by the examples below.

```ts
// src/pricing/discount.ts
export function applyDiscount(total: number, percent: number): number {
  if (percent < 0 || percent > 100) throw new RangeError('percent must be 0..100');
  if (total === 0) return 0;
  return Math.round(total * (1 - percent / 100) * 100) / 100;
}
```

**BAD - happy path only (WARNING).** The range guard, `total === 0` and rounding are never exercised;
deleting the guard still passes.

```ts
// src/pricing/discount.test.ts
it('applies a discount', () => {
  expect(applyDiscount(100, 10)).toBe(90);
});
```

**GOOD - negative, boundary and rounding cases.**

```ts
it.each([[-1], [101]])('rejects percent %d', (p) => {
  expect(() => applyDiscount(100, p)).toThrow(RangeError);
});
it.each([[100, 0, 100], [100, 100, 0], [0, 50, 0]])('boundaries: %d at %d%% = %d', (t, p, out) => {
  expect(applyDiscount(t, p)).toBe(out);
});
it('rounds to cents', () => {
  expect(applyDiscount(19.99, 15)).toBe(16.99);
});
```

**BAD - async rejection asserted without `await` (CRITICAL).** The promise is never awaited, so the
test passes even if `loadUser` resolves.

```ts
it('fails when the user is missing', () => {
  expect(loadUser('missing')).rejects.toThrow(NotFoundError);
});
```

**GOOD**

```ts
it('fails when the user is missing', async () => {
  await expect(loadUser('missing')).rejects.toThrow(NotFoundError);
});
```

**BAD - the mock is the thing being asserted (WARNING).** The repository is mocked to succeed, and
the test only checks that the mock was called; the error path of `createSkill` is unreachable.

```ts
const repo = { create: vi.fn().mockResolvedValue({ id: 's1' }) };
it('creates a skill', async () => {
  await service.createSkill(repo, input);
  expect(repo.create).toHaveBeenCalled();
});
```

**GOOD - real outcome checked, failure path reachable.**

```ts
it('creates a skill and returns its DTO', async () => {
  const repo = { create: vi.fn().mockResolvedValue(row) };
  expect(await service.createSkill(repo, input)).toEqual(toSkillDto(row, 0));
  expect(repo.create).toHaveBeenCalledWith('ws1', input);
});
it('maps a duplicate name to 409', async () => {
  const repo = { create: vi.fn().mockRejectedValue(uniqueViolation) };
  await expect(service.createSkill(repo, input)).rejects.toMatchObject({ statusCode: 409 });
});
```

## Finding template

> **WARNING - Untested guard: `applyDiscount` range check**
> `src/pricing/discount.ts:3` throws for `percent < 0 || percent > 100`; `src/pricing/discount.test.ts:2`
> tests only `applyDiscount(100, 10)`.
> Missing case: `applyDiscount(100, 101)` and `applyDiscount(100, -1)` throw `RangeError`.
> Impact: removing or inverting the guard ships unnoticed; customers could get more than 100% off.
> Fix: add a parameterized test for both out-of-range values and for the boundaries `0` and `100`.
