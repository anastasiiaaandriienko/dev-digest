# e2e architecture

Verified against `e2e/run.ts`, `e2e/lib/assert.ts`, `e2e/specs/*`,
`scripts/e2e.sh`, `.github/workflows/e2e-web.yml` and `server/src/db/seed.ts` on
2026-10-11. The flow format and the coverage table are in [../README.md](../README.md).

Labels: **[implemented]** = verified in code; **[assumption]** = something the
suite relies on without checking it; **[gap]** = not covered.

## 1. Framework

- **[implemented]** The external **agent-browser** CLI drives a real Chrome over
  CDP. The binary name comes from `AGENT_BROWSER_BIN` (default `agent-browser`).
  agent-browser is **not** a dependency in `package.json`; it is installed globally.
- **[implemented]** `run.ts` is the whole "framework":
  1. It loads `specs/*.flow.json`, sorted by filename (`run.ts:53-61`).
  2. For each step, it replaces `{BASE}` with `E2E_BASE_URL` (default
     `http://localhost:3000`; trailing slash trimmed) and calls
     `execFile(BIN, args)` with `E2E_STEP_TIMEOUT` (default 60 s) and a 32 MB
     output buffer (`run.ts:44-51`).
  3. **A step passes** when the command exits with code 0 and, if the step has
     `assert.stdoutIncludes`, its output contains that text. In every other case
     the flow stops at that step, and an exception also triggers a screenshot to
     `test-results/<flow-id>-fail.png` (`run.ts:68-89`). The `stdoutIncludes`
     check is supported, but no spec uses it today.
  4. It always runs `agent-browser close` at the end (`run.ts:108-111`), prints a
     PASS/FAIL summary, and exits with 0 only if every flow passed.
- **[implemented]** Flows run **one after another in one browser session**,
  because the agent-browser daemon keeps the page between calls. A failing flow
  does not stop the flows after it.
- **[implemented]** `agent-browser.json` sets `headed: false`.
- **[gap]** There are no retries, no per-flow isolation (cookies and storage
  persist across flows) and no parallelism.

## 2. Test organization

| Spec | Starts at | Key assertions | Needs seed? |
|---|---|---|---|
| `01-app-boot` | `/` | URL → `/pulls`; text "Pull Requests" | ≥ 1 repo |
| `02-repo-pulls-detail` | `/` | PR title row; click → `/pulls/482`; title on detail | PR #482 is in the **first** repo |
| `03-agents` | `/agents` | "Security Reviewer" | seeded agents |
| `04-pr-findings` | `/` → PR #482 | "Agent runs" tab → `tab=findings`; "request changes"; "2 findings"; "Hardcoded Stripe secret key in commit" | seeded review |
| `05-pr-diff` | `/` → PR #482 | "Files changed" tab → `tab=diff`; "src/config.ts" | seeded `pr_files` |
| `06-onboarding` | `/onboarding` | "Add a repository", "Repository URL" (no submit) | — |
| `07-settings` | `/settings/api-keys`, `/settings/models` | "API Keys", "Feature Models" | — |

**Why flows 02, 04 and 05 depend on a clean DB.** The root page sends you to the
**first** repo returned by `GET /repos` (`client/src/app/page.tsx`), and these
three flows expect that repo to be `acme/payments-api`. They run correctly only
when the seed is the only data in the database.

## 3. Environment setup

| | Local hermetic (`scripts/e2e.sh`) | CI (`.github/workflows/e2e-web.yml`) |
|---|---|---|
| Postgres | `docker run --rm` of `pgvector/pgvector:pg16` on **:5433**, ephemeral, no volume | `docker compose up -d` (`devdigest-postgres`) on :5432 |
| Dependencies | `pnpm install` (server, client) / `npm ci` (reviewer-core), **only if `node_modules` is missing** | `pnpm install --frozen-lockfile`, `npm ci` |
| DB | `pnpm db:migrate` + `pnpm db:seed`, guarded so they refuse to run unless `DATABASE_URL` is on the isolated port | migrate + seed |
| API | `pnpm exec tsx src/server.ts` on **:3101**; waits for `/health` | same command on :3001 |
| Web | `next dev -p 3100` (dev server) | `pnpm build` + `pnpm start` (production build) on :3000 |
| Runner | `cd e2e && npm test` | `npm ci && npm test`; uploads `e2e/test-results/**` when a run fails |
| Teardown | a trap on EXIT, INT and TERM kills the process trees, frees the alternate ports and runs `docker rm -f` on the container | the runner VM is discarded |

**How `e2e.sh` configures the stack.** It exports `DATABASE_URL`, `API_PORT`,
`WEB_PORT`, `NEXT_PUBLIC_API_BASE` and `E2E_BASE_URL` before anything else starts.
dotenv does not override variables that are already set, so these values win over
`server/.env`. `WEB_PORT` also sets the API's CORS origin.

**[assumption]** Local runs use `next dev`, while CI runs a production build. A
problem that only occurs in one of the two modes is caught in that mode alone.

## 4. Fixtures (seed data)

All fixtures come from `server/src/db/seed.ts`; the e2e package has none of its own.

| Data | Detail used by flows |
|---|---|
| Repo | `acme/payments-api` (no clone on disk) |
| PR #482 | title "Add rate limiting to public API endpoints"; 4 `pr_files` rows, including `src/config.ts`, **without patches**; 1 commit `a1b2c3d4e5f6` |
| Review | `verdict: request_changes`, `score: 61`, `model: 'seed'`. It has **no `run_id` and no `agent_id`**, so the accordion shows the agent name "Agent". |
| Findings | CRITICAL "Hardcoded Stripe secret key in commit" (`src/config.ts:12`) and WARNING "N+1 query in user list endpoint" (`src/api/users.ts:45-52`) |
| Agents | the three built-in presets: General, Security and Performance Reviewer |
| Runs and traces | **none.** The PR timeline shows only the commit, and the Trace drawer has nothing to open. |

## 5. Authentication

- **[implemented]** There is no login. The API uses `LocalNoAuthProvider`
  (`server/src/adapters/auth/local.ts`), which always resolves the default
  workspace and the system user, so flows need neither credentials nor cookies.
- **[implemented] Secrets are not isolated.** The API reads keys from
  `~/.devdigest/secrets.json`, a path fixed in `server/src/platform/config.ts`,
  with `process.env` as the fallback. The hermetic stack therefore sees **the
  developer's real API keys and GitHub token**. Today's flows never trigger an LLM
  call. With a GitHub token present, however, `GET /repos/:id/pulls` tries a
  GitHub sync for `acme/payments-api`; that call fails and the failure is
  swallowed, so seeded data is served.
- **[implemented] Clone directory.** `DEVDIGEST_CLONE_DIR` is not overridden
  either, but no flow imports or clones a repo.

## 6. How the flows interact with server and client

```
agent-browser ──CDP──▶ Chrome ──HTTP──▶ Next.js (web) ──fetch NEXT_PUBLIC_API_BASE──▶ Fastify API ──▶ Postgres (seeded)
```

- **Black box.** Flows see only rendered text and the URL. They don't call the
  API directly and don't read the DB.
- **Waiting for data.** `wait --load networkidle` waits for React Query fetches to
  finish. The text then comes from `messages/en/*.json` or from seed data.
- **Polling while idle.** The PR list refetches every 60 s, and run lists poll only
  while a run is active. With the seed there are no active runs, so pages go idle.
- **Copy the flows depend on.** The flows match exact strings such as "Agent runs",
  "Files changed", "request changes" and "2 findings". "request changes" is built
  by `verdict.replace("_", " ")`, and "2 findings" is a hard-coded English plural
  in `ReviewRunAccordion`. Renaming any of them breaks the flows; see
  [../specs/review-flow.md](../specs/review-flow.md).

## 7. Coverage gaps

- **No flow starts a review.** Running one needs an LLM key and a diff. The
  seeded `pr_files` have no patches and the repo has no clone, and the server has
  no test-mode or mock LLM. Live progress (SSE), run completion, the timeline and
  the Trace drawer are therefore **not covered** end to end.
- **Finding actions aren't covered either.** No flow clicks Accept or Dismiss,
  because those calls would change the DB.
