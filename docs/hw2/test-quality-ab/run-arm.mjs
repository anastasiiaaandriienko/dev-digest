#!/usr/bin/env node
// HW2 Test Quality A/B — run ONE arm against a running DevDigest API and save
// its evidence. NOT executed by the author: each run is a PAID LLM call and
// writes agent_runs / reviews / findings / run_traces to the database the API
// uses. Run it only with that understood (see ../TEST_QUALITY_AB_EXPERIMENT.md).
//
// Usage (Node >= 22, no dependencies):
//   API=http://localhost:3001 PR_ID=<uuid> AGENT_ID=<uuid> SKILL_ID=<uuid> ARM=A \
//     node docs/hw2/test-quality-ab/run-arm.mjs
//   ARM=A → the agent's `test-quality` link enabled=false; ARM=B → enabled=true.
//   Other links keep their order and state. Writes ab-evidence/<ARM>-skills-<off|on>.json.
//   DRY_RUN=1 only prints the plan (reads the agent + its skills, no writes, no LLM).

import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API ?? 'http://localhost:3001';
const { PR_ID, AGENT_ID, SKILL_ID, ARM } = process.env;
const DRY_RUN = process.env.DRY_RUN === '1';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 10 * 60_000);

if (!PR_ID || !AGENT_ID || !SKILL_ID || (ARM !== 'A' && ARM !== 'B')) {
  console.error('PR_ID, AGENT_ID, SKILL_ID and ARM=A|B are required');
  process.exit(2);
}
const label = ARM === 'A' ? 'A-skills-off' : 'B-skills-on';
const md5 = (s) => (s == null ? null : createHash('md5').update(s).digest('hex'));

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

const agent = await call('GET', `/agents/${AGENT_ID}`);
const links = await call('GET', `/agents/${AGENT_ID}/skills`);
if (!links.some((l) => l.skill_id === SKILL_ID)) throw new Error('SKILL_ID is not linked to AGENT_ID');
const wanted = ARM === 'B';
const nextLinks = [...links]
  .sort((a, b) => a.order - b.order)
  .map((l) => ({ skill_id: l.skill_id, enabled: l.skill_id === SKILL_ID ? wanted : l.enabled }));

console.log(`[${label}] agent ${agent.name} — ${agent.provider}/${agent.model}, strategy ${agent.strategy}`);
console.log(`[${label}] links after toggle:`, nextLinks);
if (DRY_RUN) process.exit(0);

await call('PUT', `/agents/${AGENT_ID}/skills`, { skills: nextLinks });
const started = await call('POST', `/pulls/${PR_ID}/review`, { agentId: AGENT_ID });
const runId = started.runs[0]?.run_id;
if (!runId) throw new Error('no run id returned');
console.log(`[${label}] run ${runId} started`);

const deadline = Date.now() + TIMEOUT_MS;
let run;
for (;;) {
  const runs = await call('GET', `/pulls/${PR_ID}/runs`);
  run = runs.find((r) => r.run_id === runId);
  if (run && run.status !== 'running') break;
  if (Date.now() > deadline) throw new Error(`run ${runId} still running after ${TIMEOUT_MS} ms`);
  await new Promise((r) => setTimeout(r, 3000));
}

const trace = await call('GET', `/runs/${runId}/trace`);
const reviews = await call('GET', `/pulls/${PR_ID}/reviews`);
const review = reviews.find((r) => r.run_id === runId) ?? null;
const pa = trace.prompt_assembly;

const evidence = {
  label,
  pr: { id: PR_ID },
  agent: { id: AGENT_ID, name: agent.name, provider: agent.provider, model: agent.model, version: agent.version },
  skill_links: nextLinks,
  agent_run: run,
  review: review && {
    id: review.id,
    verdict: review.verdict,
    score: review.score,
    model: review.model,
    grounding: review.grounding,
    summary: review.summary,
  },
  findings: (review?.findings ?? []).map((f) => ({
    severity: f.severity,
    category: f.category,
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    confidence: f.confidence,
    title: f.title,
    rationale: f.rationale,
    suggestion: f.suggestion,
  })),
  trace: {
    stats: trace.stats,
    config: trace.config,
    tool_calls: trace.tool_calls,
    prompt_assembly: {
      skill_blocks: pa.skill_blocks ?? null,
      skills_tokens: pa.skills_tokens ?? null,
      pr_description: pa.pr_description ?? null,
      system_chars: pa.system.length,
      user_chars: pa.user.length,
      system_md5: md5(pa.system),
      // Control: the system prompt minus the Skills section must match across arms.
      system_without_skills_md5: md5(pa.skills ? pa.system.replace(pa.skills, '') : pa.system),
      user_md5: md5(pa.user),
    },
    log: trace.log,
  },
  raw_output: trace.raw_output,
};

const out = join(dirname(fileURLToPath(import.meta.url)), 'ab-evidence', `${label}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`[${label}] ${run.status}: ${evidence.findings.length} finding(s), cost ${trace.stats.cost_usd ?? 'unknown'} → ${out}`);
