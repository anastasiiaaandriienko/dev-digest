# CLAUDE.md — e2e (`@devdigest/e2e`)

Package-level guide. The root [`../CLAUDE.md`](../CLAUDE.md) (repo layout, global
"do not touch" rules) still applies; this file adds only what is specific to the
browser suite. Details live in the linked docs — open them only when needed.

## What this package is

- **Deterministic browser flows** against the real stack (Next.js web + Fastify API
  + seeded Postgres), driven by the external **agent-browser** CLI (Rust + CDP).
  No Playwright, no test framework, no LLM, no API key.
- A flow = `specs/NN-name.flow.json`: an ordered list of agent-browser argv. `run.ts`
  executes every flow in filename order in **one shared browser session**; a
  non-zero exit (e.g. `wait --text` timing out) fails the step and stops that flow.
- Flows are **read-only over seeded data** (repo `acme/payments-api`, PR #482, its
  seeded review, the seeded agents). Nothing clicks "Run review".

## Files

| Path | Role |
|---|---|
| `run.ts` | runner: load specs, run steps, failure screenshot, summary, exit code |
| `lib/assert.ts` | `Flow`/`Step` types, `{BASE}` substitution, `stdoutIncludes` check |
| `specs/*.flow.json` | the 7 flows (boot, PR detail, agents, findings, diff, onboarding, settings) |
| `agent-browser.json` | CLI config (headless) |
| `../scripts/e2e.sh` | local hermetic stack (isolated Postgres :5433, API :3101, web :3100) |
| `../.github/workflows/e2e-web.yml` | CI: dev ports, `pnpm build` + `pnpm start`, then `npm test` |

## Commands

```sh
npm run typecheck        # tsc over run.ts + lib/ (specs are JSON, not type-checked)
npm test                 # tsx run.ts — needs a running, freshly-seeded stack
npm run e2e:hermetic     # = ../scripts/e2e.sh (boots + seeds + tears down its own stack)
```

**Ask the user before running `npm test` or `e2e.sh`.** `e2e.sh` starts Docker,
may run `pnpm install` / `npm ci`, and runs `db:migrate` + `db:seed` (on its isolated
DB) — all of which the root rules gate behind approval. The agent-browser CLI is a
global install (`npm i -g agent-browser && agent-browser install`) — also ask.

## Conventions

- Locators are deterministic only: `wait --url`, `wait --text`, `wait --load`,
  `find text|role … click`. Never the AI `chat` command.
- Assert on **user-visible text** that the seed guarantees; when UI copy or seed
  data changes, update the affected flows in the same change.
- Each flow starts from `open {BASE}/…` (session is shared, so don't rely on the
  previous flow's page). Number new flows `08-…`; order = filename order.
- Use `npm` here (own `package-lock.json`); the package has no runtime deps.

## Boundaries

- Never point the suite at a dev DB with extra repos (flows 02/04/05 follow the
  "first repo" redirect) and never `docker compose down -v` to "reset" it.
- The hermetic API still reads `~/.devdigest/secrets.json` — real keys on the
  machine are visible to it. Don't add flows that trigger reviews or imports.
- Don't edit `scripts/e2e.sh`, the workflow, or the seed to make a flow pass
  without asking; they are shared with other suites.

## Read When

- **Understanding how the runner, stack, seed and auth fit together** →
  [docs/architecture.md](docs/architecture.md)
- **Running, debugging or fixing a failing flow; cleanup after a crash** →
  [docs/testing.md](docs/testing.md)
- **Adding or changing flows for the PR review UI (incl. L01)** →
  [specs/review-flow.md](specs/review-flow.md), then
  [../client/specs/l01-review-ui.md](../client/specs/l01-review-ui.md)
- **Flow format, env knobs, coverage table** → [README.md](README.md)
- **How e2e fits with unit/integration suites and CI** → [../TESTING.md](../TESTING.md)
- **The UI being exercised (routes, components, i18n)** →
  [../client/docs/architecture.md](../client/docs/architecture.md)
- **The API behaviour behind the pages (runs, SSE, traces)** →
  [../server/docs/architecture.md](../server/docs/architecture.md)
- **Repo-wide rules** → [../CLAUDE.md](../CLAUDE.md)
