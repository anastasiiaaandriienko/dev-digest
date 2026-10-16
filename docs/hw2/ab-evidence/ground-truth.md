# A/B ground truth — test PR `test/api-contract-ab` (fixed before any LLM review)

Base: `origin/main` 28c84bb. Test PR: https://github.com/anastasiiaaandriienko/dev-digest/pull/3 (draft), head `109471f2fdf128531aae4bdd5e036e3748a1cd1c`. Diff: 3 files, +8 / −5 (server only).

| ID | File:line (new) | Change | Breaking? | Why |
|---|---|---|---|---|
| GT1 | `server/src/vendor/shared/contracts/knowledge.ts:182`, `server/src/modules/agents/helpers.ts:19` | Response field `system_prompt` renamed to `instructions` in the `Agent` DTO (GET /agents, GET /agents/:id, POST /agents and update responses) | **Yes** | Existing clients reading `system_prompt` get `undefined` |
| GT2 | `server/src/modules/agents/routes.ts:109` | `PUT /agents/:id` → `PATCH /agents/:id`; no PUT route left | **Yes** | Existing `PUT` calls now get 404 |
| GT3 | `server/src/modules/agents/routes.ts:35` | `POST /agents` body: `description` was optional, now required (`min(1)`) | **Yes** | Existing requests without `description` now get 422 |
| DECOY | `server/src/vendor/shared/contracts/knowledge.ts:192`, `server/src/modules/agents/helpers.ts:26` | New **optional** response field `created_at` | **No** | Additive: old clients ignore an extra field |

Scoring rules (decided before the runs):
- **Detected** = a finding points at the change (right file, or the right route / field) and calls it breaking or incompatible for existing clients.
- **False positive** = a finding calls the DECOY breaking, or reports a breaking change that is not in the diff.
- **Neutral** = valid remarks that are not about the four changes (e.g. the request body still says `system_prompt` while the response says `instructions`; missing version bump / migration note). Listed, not scored.
