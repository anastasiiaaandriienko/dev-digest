# Running, debugging and troubleshooting e2e

This page is about the existing scripts, verified on 2026-10-11. The flow format
and env knobs are in [../README.md](../README.md), and the stack internals are in
[architecture.md](architecture.md).

> Every command below starts processes, and some of them install dependencies or
> migrate and seed a database. Per the root [../../AGENTS.md](../../AGENTS.md), an
> agent must get the user's approval before running them.

## Prerequisites

| Need | Why | Check |
|---|---|---|
| Node ≥ 22 and npm | runner (`tsx`) | `node -v` |
| pnpm ≥ 10 | `e2e.sh` installs and runs server and client | `pnpm -v` (the script exits without it) |
| Docker daemon | isolated Postgres | `docker info` (the script exits without it) |
| agent-browser + Chrome for Testing | drives the browser | `agent-browser --version`; install with `npm i -g agent-browser && agent-browser install` (the script only **warns** if it is missing, and then every step fails) |
| `e2e/node_modules` | `tsx`, `typescript` | `cd e2e && npm ci` (`e2e.sh` does **not** install e2e deps) |
| bash with `pgrep`, `lsof` and `curl` | `e2e.sh` teardown and health checks | On Windows use Git Bash or WSL. Where `pgrep`/`lsof` are missing, the teardown commands fail silently and can leave processes behind (see below). |

## Ways to run

1. **Hermetic (recommended).** From the repo root, run `./scripts/e2e.sh`, or
   `cd e2e && npm run e2e:hermetic`.
   - It starts Postgres on :5433, the API on :3101 and the web app on :3100,
     migrates and seeds, runs `npm test`, and tears everything down.
   - It exits with the runner's exit code.
   - Ports can be overridden with `E2E_PG_PORT`, `E2E_API_PORT` and `E2E_WEB_PORT`;
     the container with `E2E_PG_CONTAINER` and `E2E_PG_IMAGE`; the credentials
     with `E2E_PG_DB`, `E2E_PG_USER` and `E2E_PG_PASS`.
2. **Against a stack that is already running.** Run `cd e2e && npm test`. Set
   `E2E_BASE_URL` if the web app is not on :3000. This is only valid if that DB
   holds **only** seed data (see "Wrong repo" below).
3. **One flow.** The runner has no filter flag. To run a single flow, replay its
   steps by hand with `agent-browser <cmd…>` against a running stack, in the same
   order as in the JSON.

## Expected services during a run

| Service | Hermetic | CI / dev |
|---|---|---|
| Postgres | container `devdigest-e2e-postgres`, :5433 | `devdigest-postgres`, :5432 |
| API | `http://localhost:3101/health` → `{"status":"ok"}` | :3001 |
| Web | `http://localhost:3100` | :3000 |

## Reading results

- **Console output.** Each flow prints `▶ name (file)` followed by a `✓`/`✗` line
  per step. The final summary has `PASS`/`FAIL` per flow and `N/M flows passed`.
- **Failure screenshot.** A failing command produces `e2e/test-results/<id>-fail.png`,
  e.g. `04-pr-findings-fail.png`. The directory is git-ignored, and CI uploads it
  as the `e2e-failure` artifact.
  - No screenshot is taken when a step fails only its `stdoutIncludes` check.
  - Screenshots are overwritten on the next failure.
- **Logs.** `e2e.sh` streams API and web output to the same terminal. In CI those
  go to `$RUNNER_TEMP/{api,web}.log`, which is printed only when a health check fails.

## Debugging a failing step

1. Read the step label and the first line of the error: usually a `wait` timed out.
2. Open the screenshot. Did the page render the wrong repo, an error state or a skeleton?
3. Reproduce by hand. With the stack up, run the same commands, e.g.
   `agent-browser open http://localhost:3100/` and then `agent-browser wait --text "…"`.
   Edit `agent-browser.json` locally (`"headed": true`) to watch the browser, but
   don't commit that change.
4. Check whether the expected text still exists: search `client/messages/en/*.json`,
   the component, or `server/src/db/seed.ts`.
5. If a fetch is slow, try a larger `E2E_STEP_TIMEOUT` (ms) to tell slowness apart
   from a missing element.

## Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Flows 02/04/05 time out waiting for "Add rate limiting…" | the DB has other repos, so the root redirect picked another one | run hermetic; don't wipe your dev DB with `down -v` |
| Every step fails immediately (`ENOENT`) | agent-browser not on `PATH` | install it, or set `AGENT_BROWSER_BIN` |
| "API process exited before becoming healthy" | reviewer-core deps missing (`ERR_MODULE_NOT_FOUND`), or a bad `DATABASE_URL` | `cd reviewer-core && npm ci` (with approval); check the terminal log |
| "isolated Postgres did not become healthy" | Docker not running, or port 5433 taken | start Docker; set `E2E_PG_PORT` |
| "web never became reachable" | `next dev` compile error, or port in use | check the terminal output; set `E2E_WEB_PORT` |
| UI renders but every API call fails (CORS) | `WEB_PORT` / `NEXT_PUBLIC_API_BASE` mismatch when running by hand | export both, as `e2e.sh` does |
| Text assertion fails after a UI change | copy changed: hard-coded strings or i18n keys | update the flow in the same change (see [../specs/review-flow.md](../specs/review-flow.md)) |
| Flow 01 lands on onboarding | the seed did not run (zero repos) | check the `db:seed` output |

## Cleanup

- **Normal case.** `e2e.sh` cleans up on exit, failure and Ctrl-C.
- **After a crash or `kill -9`,** remove the leftovers:

  ```sh
  docker rm -f devdigest-e2e-postgres        # or your E2E_PG_CONTAINER
  lsof -nP -iTCP:3100 -sTCP:LISTEN -t        # find leftover web/API listeners (also 3101)
  agent-browser close                        # end a dangling browser session
  ```

  On Windows without `lsof`, use `netstat -ano | findstr :3100` and end the PID.
- **What is safe.** The isolated Postgres keeps no volume, so nothing persists.
  Never delete `devdigest_pgdata`: that volume is your dev DB.
- **Before committing,** run `npm run typecheck`. It covers `run.ts` and `lib/`;
  JSON specs are not schema-checked.
