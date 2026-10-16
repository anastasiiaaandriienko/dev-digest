---
name: semver-discipline
description: Require the version bump and changelog entry that match an API contract change - major for breaking, minor for additive, patch for fixes.
type: convention
---

# Semver discipline

You check that a pull request that changes a **published API contract** also changes its
**version** the way Semantic Versioning (`MAJOR.MINOR.PATCH`) requires, and records it. Use this
skill together with `breaking-change`: that skill decides *whether* the contract broke; this one
checks the version and changelog say so.

Where versions live: the `version` in a package's `package.json` (for a published package or SDK),
an API version in the route prefix (`/v1/...`) or an `API_VERSION` constant, and a `CHANGELOG.md`
next to it. Only apply this skill when the PR touches one of those **or** a public contract of a
package that has one.

## Rules

1. **Breaking change - MAJOR bump.** Removed or renamed routes, fields or enum values, stricter
   validation, incompatible type changes: bump MAJOR (`1.4.2` to `2.0.0`), or serve the new contract
   under a new version prefix (`/v2`) while `/v1` keeps working.
2. **Additive change - MINOR bump.** New route, new optional request field, new response field,
   new accepted enum value: bump MINOR (`1.4.2` to `1.5.0`).
3. **Fix with no contract change - PATCH bump.** Bug fix that makes the code match the documented
   contract: bump PATCH (`1.4.2` to `1.4.3`).
4. **Pre-1.0 (`0.y.z`)**: a breaking change bumps MINOR (`0.4.2` to `0.5.0`); say so explicitly.
5. **One bump per release**: do not bump twice in one PR, and never decrease a version.
6. **Changelog entry**: every bump has a `CHANGELOG.md` entry under the new version, with a
   `Breaking` section that lists each breaking change and the migration step for clients.
7. **Version and contract agree**: a `/v2` prefix must not appear on unchanged routes only; a major
   bump with no breaking change is also wrong (it forces needless client upgrades).

## Do NOT report

- Repos or packages that are not versioned (no `version`, no `/vN` prefix, private apps with
  `"private": true` and no published API). DevDigest's own `server` and `client` are private: do not
  demand version bumps for their internal routes.
- PRs that change only tests, docs, internal code or tooling.
- A missing bump when the PR description or changelog states the release is cut separately (a
  release PR does the bump) - mention it as a SUGGESTION at most.
- Disagreement about MINOR vs PATCH for a change whose contract impact you cannot see in the diff.

## Evidence (required for every finding)

- **file + line** of the contract change, and of the version (or its absence: name the file that
  should change).
- **Affected contract** and the kind of change (breaking / additive / fix).
- **Expected vs actual version**: `expected 2.0.0 (breaking), found 1.5.0`.
- **Impact**: consumers pinned to `^1` upgrade automatically and break.

Severity: **CRITICAL** for a breaking change released as MINOR or PATCH; **WARNING** for a missing
bump or changelog entry on an additive change; **SUGGESTION** for wording or ordering issues in the
changelog. Category: `bug`.

## Examples

**BAD - field removed, released as a minor (CRITICAL).**

```diff
// packages/devdigest-sdk/package.json
- "version": "1.4.2",
+ "version": "1.5.0",
```

```diff
// packages/devdigest-sdk/src/types.ts
export interface Finding {
  id: string;
- rationale: string;
}
```

**GOOD - breaking change, major bump and a changelog with the migration step.**

```diff
- "version": "1.4.2",
+ "version": "2.0.0",
```

```md
## 2.0.0
### Breaking
- `Finding.rationale` was removed; read `Finding.explanation` instead.
```

**GOOD - additive change, minor bump (do not report).**

```diff
- "version": "1.4.2",
+ "version": "1.5.0",
```

```ts
export interface Agent {
  id: string;
  skill_count?: number; // new, optional
}
```

**BAD - new API version on unchanged routes (WARNING).** `/v2/skills` is identical to `/v1/skills`;
there is nothing to migrate to.

```diff
+ app.register(skillsRoutes, { prefix: '/v2' }); // same handlers, same schemas as /v1
```

## Finding template

> **CRITICAL - Breaking change released as a minor version**
> `packages/devdigest-sdk/src/types.ts:41` removes `Finding.rationale`;
> `packages/devdigest-sdk/package.json:3` bumps `1.4.2` to `1.5.0`.
> Expected: `2.0.0` with a `Breaking` changelog entry.
> Impact: consumers on `^1.4.0` install 1.5.0 automatically and lose `rationale` at runtime.
