---
name: deprecation-policy
description: Require a deprecation path before an API route, field or enum value is removed - mark it, keep it working, document the replacement and the removal date.
type: convention
---

# Deprecation policy

You check that parts of a public API are **retired in steps**, never removed in one go:

1. **Deprecate** - mark it (code comment, OpenAPI or Zod `.describe`, `Deprecation` and `Sunset`
   response headers) and document the replacement.
2. **Keep it working** for the stated period (at least one minor release or the documented
   window) while the replacement exists side by side.
3. **Remove** it in a later, major release, listed under `Breaking` in the changelog.

Use this skill with `breaking-change` (is it breaking?) and `semver-discipline` (is the version
right?). This one checks the **path** that leads to the removal.

## Report it when the diff does any of these

1. **Removal without prior deprecation** - a route, request or response field, query param or enum
   value is deleted and nothing in the diff, the code comments or the changelog shows it was
   deprecated before.
2. **Deprecation without a replacement** - something is marked deprecated but there is no
   documented alternative (`use X instead`).
3. **Deprecated thing stops working early** - a deprecated route now returns `410`, ignores its
   input, or returns different data while the deprecation window is still open.
4. **Deprecation not visible to clients** - only an internal comment marks it; no response header,
   schema description, docs or changelog line that a client could see.
5. **Rename done as remove + add** - the old name disappears in the same PR that introduces the new
   one, instead of serving both during the window.
6. **New code depends on a deprecated contract** - the PR adds a new caller of a route or field the
   codebase already marks as deprecated.

## Do NOT report

- Internal, private or explicitly experimental APIs (`/internal/...`, `@experimental`, private apps
  with no external clients). Note: DevDigest's web client and API ship together; a route only that
  client uses can be changed in the same PR if both sides change together - report only if the PR
  changes one side and not the other.
- Removal in a PR whose changelog or description shows the deprecation happened in an earlier
  release and the window has passed.
- Deprecating something (marking only): that is the desired first step.
- Code removal that does not change the HTTP contract.

## Evidence (required for every finding)

- **file + line** of the removal or the deprecation marker.
- **Affected contract**: method + path, field or enum value.
- **What is missing**: the deprecation marker, the replacement, the window, or the changelog entry.
- **Impact**: which clients break and when (`mobile app 3.2 still calls PUT /skills/:id`).

Severity: **CRITICAL** for removal of a used contract with no deprecation path; **WARNING** for a
deprecation that is invisible to clients or has no replacement; **SUGGESTION** for missing
`Sunset` dates or changelog wording. Category: `bug`.

## Examples

**BAD - field renamed by remove + add in one PR (CRITICAL).**

```diff
export const Skill = z.object({
  id: z.string(),
- agent_count: z.number().int(),
+ agents_using: z.number().int(),
});
```

**GOOD - both fields served during the window, old one marked.**

```ts
export const Skill = z.object({
  id: z.string(),
  /** @deprecated since 1.6 - use `agents_using`; removed in 2.0. */
  agent_count: z.number().int().describe('Deprecated: use agents_using'),
  agents_using: z.number().int(),
});
```

**BAD - deprecated route removed with no notice (CRITICAL).**

```diff
- app.post('/skills/import-url', { schema: { body: ImportUrlBody } }, handler);
```

**GOOD - route kept, deprecation visible to clients, replacement named.**

```ts
app.post('/skills/import-url', { schema: { body: ImportUrlBody } }, async (req, reply) => {
  reply.header('Deprecation', 'true');
  reply.header('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT');
  reply.header('Link', '</skills/import/preview>; rel="successor-version"');
  return service.importFromUrl(workspaceId, req.body); // still works until the sunset date
});
```

```md
## 1.6.0
### Deprecated
- `POST /skills/import-url` - use `POST /skills/import/preview` + `POST /skills/import`. Removed in 2.0.0 (after 2026-12-31).
```

## Finding template

> **CRITICAL - Contract removed without a deprecation period**
> `server/src/vendor/shared/contracts/knowledge.ts:133` removes `Skill.agent_count` and adds `agents_using`.
> Missing: a release where both fields are returned and `agent_count` is marked deprecated.
> Impact: clients reading `agent_count` (the Skills page card) get `undefined` immediately.
> Fix: return both fields, mark `agent_count` deprecated with its removal version, remove it in the next major release.
