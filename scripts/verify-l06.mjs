#!/usr/bin/env node
/*
 * verify-l06.mjs — L06 Eval Pipeline verification (specs/eval-pipeline.md §17.1,
 * specs/eval-pipeline-plan.md Stage 10). Run from server/:
 *
 *   pnpm verify:l06                           static checks (no DB, no network, no LLM)
 *   pnpm verify:l06 --it                      + integration tests on a THROWAWAY Testcontainers Postgres
 *   pnpm verify:l06 --live --agent <uuid>     + read-only GETs against the running API (demo dataset)
 *   options: --skip-build  --api <url>  --help
 *
 * Steps run one after another (never in parallel) and stop at nothing: every
 * step reports PASS / FAIL / SKIP and the exit code is 1 when any step failed.
 *
 * Safety:
 *  - Test steps get DATABASE_URL replaced by an unreachable address, so nothing
 *    can reach the working database even by accident (dotenv never overrides a
 *    set variable). The original is passed as DEVDIGEST_WORKING_DATABASE_URL so
 *    the integration tests can refuse it explicitly (assertThrowawayDb).
 *  - The integration step needs Docker and runs only the L06 *.it.test.ts files,
 *    which start their own Postgres containers.
 *  - --live sends GET requests only. No step applies migrations, calls an LLM,
 *    opens the UI or writes to any database.
 *  - The client build is refused while a server listens on :3000 (a running
 *    `next dev` shares client/.next).
 */
import { spawnSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "server");
const CLIENT = join(ROOT, "client");
const BLOCKED_DB_URL = "postgres://verify-l06:blocked@127.0.0.1:1/verify_l06_blocked";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SERVER_UNIT_TESTS = [
  "test/eval-contracts.test.ts",
  "test/eval-helpers.test.ts",
  "test/eval-case-create.test.ts",
  "test/eval-scoring.test.ts",
  "test/eval-runner.test.ts",
  "test/eval-history.test.ts",
  "test/eval-db-guard.test.ts",
];
const SERVER_IT_TESTS = ["test/evals.it.test.ts", "test/evals-runs.it.test.ts"];
const CLIENT_TESTS = [
  "src/lib/evals.test.ts",
  "src/lib/hooks/evals.test.tsx",
  "src/app/eval",
  "src/app/agents/[id]/_components/AgentEditor",
  "src/app/repos/[repoId]/pulls/[number]/_components/AddToEvalModal",
  "src/app/repos/[repoId]/pulls/[number]/_components/FindingCard",
  "src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel",
  "src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion",
  "src/vendor/ui/nav.test.ts",
];
const CONTRACT_FILES = [
  join(SERVER, "src/vendor/shared/contracts/eval-ci.ts"),
  join(CLIENT, "src/vendor/shared/contracts/eval-ci.ts"),
];

// ---- arguments ------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { it: false, live: false, agent: null, skipBuild: false, api: process.env.DEVDIGEST_API_BASE ?? "http://localhost:3001", help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--it") opts.it = true;
    else if (a === "--live") opts.live = true;
    else if (a === "--skip-build") opts.skipBuild = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--agent") opts.agent = argv[++i] ?? null;
    else if (a === "--api") opts.api = argv[++i] ?? opts.api;
    else throw new Error(`unknown option: ${a}`);
  }
  if (opts.live && !opts.agent) throw new Error("--live needs --agent <uuid>");
  if (opts.agent && !UUID.test(opts.agent)) throw new Error(`--agent must be a uuid, got "${opts.agent}"`);
  return opts;
}

// ---- helpers ----------------------------------------------------------------------

/** DATABASE_URL from server/.env (or the environment) — only to refuse it, never to connect. */
function workingDatabaseUrl() {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== BLOCKED_DB_URL) return process.env.DATABASE_URL;
  const envFile = join(SERVER, ".env");
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  return line ? line.replace(/^\s*DATABASE_URL\s*=\s*/, "").replace(/^["']|["']$/g, "").trim() : undefined;
}

/** host:port/db only — never the user, password or query string (they may hold secrets). */
function redact(url) {
  if (!url) return "(none)";
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "(unparseable URL)";
  }
}

function isolatedEnv() {
  return {
    ...process.env,
    DATABASE_URL: BLOCKED_DB_URL,
    DEVDIGEST_WORKING_DATABASE_URL: workingDatabaseUrl() ?? "",
    NODE_ENV: "test",
    FORCE_COLOR: "0",
  };
}

/** Run a package binary with the current Node (no shell: bracketed paths stay intact). */
function runNode(cwd, script, args, env = isolatedEnv()) {
  const bin = join(cwd, script);
  if (!existsSync(bin)) return { ok: false, detail: `missing ${bin} (dependencies not installed?)` };
  const res = spawnSync(process.execPath, [bin, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  return { ok: res.status === 0, detail: summarize(out, res.status), out };
}

/** The interesting tail of a tool's output: vitest totals, tsc errors, next result. */
function summarize(out, status) {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tests = lines.filter((l) => /^(Test Files|Tests)\s/.test(l));
  if (tests.length) return tests.join(" · ");
  const tsErrors = lines.filter((l) => /error TS\d+/.test(l));
  if (tsErrors.length) return `${tsErrors.length} TypeScript error(s): ${tsErrors.slice(0, 3).join(" | ")}`;
  if (lines.some((l) => /Compiled successfully/.test(l))) return "compiled successfully";
  return status === 0 ? "ok" : lines.slice(-5).join(" | ") || `exit ${status}`;
}

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.setTimeout(800);
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
    socket.once("error", () => resolve(false));
  });
}

function dockerAvailable() {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function l06Block(file) {
  const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const begin = src.indexOf("// L06-EVAL:BEGIN");
  const end = src.indexOf("// L06-EVAL:END");
  return begin >= 0 && end > begin ? src.slice(begin, end) : null;
}

// ---- live (read-only GET) checks ----------------------------------------------------

async function getJson(api, path) {
  const res = await fetch(`${api}${path}`, { method: "GET", headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function liveChecks(api, agentId) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  let agent;
  try {
    agent = await getJson(api, `/agents/${agentId}`);
  } catch (err) {
    add("API reachable", false, `${api}: ${err.message}`);
    return checks;
  }
  add("GET /agents/:id", agent.status === 200, agent.status === 200 ? agent.body?.name : `HTTP ${agent.status}`);
  if (agent.status !== 200) return checks;

  const cases = await getJson(api, `/agents/${agentId}/eval-cases`);
  const list = Array.isArray(cases.body) ? cases.body : [];
  const kinds = new Set(list.map((c) => c.kind));
  add("GET /agents/:id/eval-cases", cases.status === 200, `HTTP ${cases.status}`);
  add("≥ 8 eval cases", list.length >= 8, `${list.length} case(s)`);
  add("both kinds present", kinds.has("must_find") && kinds.has("must_not_flag"),
    `must_find ${list.filter((c) => c.kind === "must_find").length} · must_not_flag ${list.filter((c) => c.kind === "must_not_flag").length}`);

  const runs = await getJson(api, `/agents/${agentId}/eval-runs?limit=100`);
  const done = (Array.isArray(runs.body) ? runs.body : []).filter((r) => r.status === "done");
  const prompts = new Set(done.map((r) => r.prompt_sha));
  add("GET /agents/:id/eval-runs", runs.status === 200, `HTTP ${runs.status}`);
  add("≥ 2 done runs with different prompts", done.length >= 2 && prompts.size >= 2, `${done.length} done run(s), ${prompts.size} distinct prompt(s)`);
  if (done.length === 0) return checks;

  const latest = done[0];
  const detail = await getJson(api, `/eval-runs/${latest.id}`);
  const results = Array.isArray(detail.body?.results) ? detail.body.results.length : 0;
  add("GET /eval-runs/:id (latest done)", detail.status === 200 && results === (latest.counts?.cases_total ?? -1),
    `HTTP ${detail.status} · ${results} case result(s) · recall ${latest.recall ?? "N/A"} · precision ${latest.precision ?? "N/A"} · citation ${latest.citation_accuracy ?? "N/A"}`);

  const head = done[0];
  const base = done.find((r) => r.prompt_sha !== head.prompt_sha);
  if (!base) {
    add("GET /eval-runs/compare", false, "no two done runs with different prompts");
    return checks;
  }
  const cmp = await getJson(api, `/eval-runs/compare?base=${base.id}&head=${head.id}`);
  add("GET /eval-runs/compare (different prompts)", cmp.status === 200 && cmp.body?.prompt_changed === true,
    `HTTP ${cmp.status} · v${base.agent_version} → v${head.agent_version} · same_case_set ${cmp.body?.same_case_set}`);
  return checks;
}

// ---- main ---------------------------------------------------------------------------

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`verify:l06: ${err.message}\nUsage: pnpm verify:l06 [--it] [--live --agent <uuid>] [--skip-build] [--api <url>]`);
    process.exit(2);
  }
  if (opts.help) {
    console.log("Usage: pnpm verify:l06 [--it] [--live --agent <uuid>] [--skip-build] [--api <url>]");
    return;
  }

  const results = [];
  const step = async (name, fn) => {
    const started = Date.now();
    process.stdout.write(`… ${name}\n`);
    let r;
    try {
      r = await fn();
    } catch (err) {
      r = { ok: false, detail: err.message };
    }
    const status = r.skip ? "SKIP" : r.ok ? "PASS" : "FAIL";
    results.push({ name, status, detail: r.detail ?? "", ms: Date.now() - started });
    process.stdout.write(`${status.padEnd(4)} ${name} — ${r.detail ?? ""}\n`);
    if (status === "FAIL" && r.out) process.stdout.write(`${r.out.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).slice(-40).join("\n")}\n`);
  };

  console.log(`verify:l06 — repo ${ROOT}`);
  console.log(`working DB (never used by tests): ${redact(workingDatabaseUrl())}; tests get DATABASE_URL=${redact(BLOCKED_DB_URL)}\n`);

  await step("contracts: L06 block identical in server + client eval-ci.ts", async () => {
    const [a, b] = CONTRACT_FILES.map(l06Block);
    if (!a || !b) return { ok: false, detail: "L06-EVAL markers missing" };
    return { ok: a === b, detail: a === b ? `${a.split("\n").length} lines match` : "the copies differ" };
  });
  await step("server: typecheck", async () => runNode(SERVER, "node_modules/typescript/bin/tsc", ["--noEmit", "-p", "tsconfig.json"]));
  await step("server: eval unit tests", async () => runNode(SERVER, "node_modules/vitest/vitest.mjs", ["run", ...SERVER_UNIT_TESTS]));
  await step("client: typecheck", async () => runNode(CLIENT, "node_modules/typescript/bin/tsc", ["--noEmit"]));
  await step("client: eval UI tests", async () => runNode(CLIENT, "node_modules/vitest/vitest.mjs", ["run", ...CLIENT_TESTS]));
  await step("client: build", async () => {
    if (opts.skipBuild) return { skip: true, detail: "--skip-build" };
    if (await portOpen(3000)) return { ok: false, detail: "something listens on :3000 (next dev shares client/.next) — stop it or pass --skip-build" };
    return runNode(CLIENT, "node_modules/next/dist/bin/next", ["build"], { ...isolatedEnv(), NODE_ENV: "production" });
  });

  await step("server: L06 integration tests (Testcontainers)", async () => {
    if (!opts.it) return { skip: true, detail: "pass --it (needs Docker)" };
    if (!dockerAvailable()) return { ok: false, detail: "Docker is not reachable; the tests would only be skipped" };
    const r = runNode(SERVER, "node_modules/vitest/vitest.mjs", ["run", ...SERVER_IT_TESTS]);
    // describe.skip without Docker would "pass" with 0 run tests — treat that as a failure.
    if (r.ok && /skipped/.test(r.detail) && !/passed/.test(r.detail)) return { ...r, ok: false, detail: `${r.detail} (nothing ran)` };
    return r;
  });

  if (opts.live) {
    const checks = await liveChecks(opts.api.replace(/\/$/, ""), opts.agent);
    for (const c of checks) results.push({ name: `live: ${c.name}`, status: c.ok ? "PASS" : "FAIL", detail: c.detail ?? "", ms: 0 });
    for (const c of checks) process.stdout.write(`${(c.ok ? "PASS" : "FAIL").padEnd(4)} live: ${c.name} — ${c.detail ?? ""}\n`);
  } else {
    results.push({ name: "live: demo dataset (read-only GET)", status: "SKIP", detail: "pass --live --agent <uuid>", ms: 0 });
  }

  const failed = results.filter((r) => r.status === "FAIL");
  console.log("\n==================== verify:l06 summary ====================");
  for (const r of results) {
    const secs = r.ms ? ` (${(r.ms / 1000).toFixed(1)}s)` : "";
    console.log(`${r.status.padEnd(4)}  ${r.name}${secs}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log("============================================================");
  console.log(failed.length === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failed.length} step(s) failed)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`verify:l06 crashed: ${err.stack ?? err}`);
  process.exit(1);
});
