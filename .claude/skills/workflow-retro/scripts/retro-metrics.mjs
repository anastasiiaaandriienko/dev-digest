#!/usr/bin/env node
// Aggregates Claude Code session transcripts (JSONL) into workflow metrics for
// /workflow-retro. Prints numbers, tool names and short redacted previews only —
// never message text. The JSONL format is internal to Claude Code: every field is
// read defensively and anything missing is reported as UNKNOWN.
//
// Usage:
//   node retro-metrics.mjs [--session <id> | --latest] [--project-dir <dir>]
//                          [--since <ISO>] [--until <ISO>] [--deep] [--json]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(name);

const projectDir =
  opt('--project-dir') ?? join(homedir(), '.claude', 'projects', process.cwd().replace(/[:\\/]/g, '-'));
const since = opt('--since') ? Date.parse(opt('--since')) : -Infinity;
const until = opt('--until') ? Date.parse(opt('--until')) : Infinity;
const deep = flag('--deep');

function fail(msg) {
  console.error(`retro-metrics: ${msg}`);
  process.exit(1);
}

function pickSession() {
  if (!existsSync(projectDir)) fail(`project dir not found: ${projectDir}`);
  const id = opt('--session');
  if (id) return id;
  if (!flag('--latest')) fail('pass --session <id> or --latest');
  const files = readdirSync(projectDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, t: statSync(join(projectDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (files.length === 0) fail(`no transcripts in ${projectDir}`);
  return files[0].f.replace(/\.jsonl$/, '');
}

function readJsonl(path) {
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A partially written last line is expected while a session is running.
    }
  }
  return out;
}

const SECRET = /(gh[pousr]_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|(?:api[_-]?key|token|password|secret)\s*[=:]\s*\S+)/gi;
const redact = (s) => String(s).replace(SECRET, '[REDACTED]').replace(/\s+/g, ' ').slice(0, 90);

/** Short, redacted label for a tool call — enough to spot repeats, no payloads. */
function preview(name, input = {}) {
  if (input.command) return redact(input.command);
  if (input.file_path) return redact(input.file_path);
  if (input.pattern) return redact(`${input.pattern}${input.path ? ` @ ${input.path}` : ''}`);
  if (input.url) return redact(input.url);
  if (input.query) return redact(input.query);
  if (input.description) return redact(input.description);
  return name;
}

const inWindow = (ts) => {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t >= since && t <= until : true;
};

/** Metrics for one transcript. Usage is de-duplicated by message id: one API
 *  response is written as several lines that repeat the same usage object. */
function analyse(records) {
  const usageById = new Map();
  const toolUses = new Map();
  const toolResults = new Map();
  const agentCalls = [];
  let turnMs = 0;
  let turns = 0;
  let first = null;
  let last = null;

  for (const r of records) {
    if (!r.timestamp || !inWindow(r.timestamp)) continue;
    first ??= r.timestamp;
    last = r.timestamp;
    if (r.type === 'system' && r.subtype === 'turn_duration' && typeof r.durationMs === 'number') {
      turnMs += r.durationMs;
      turns += 1;
    }
    const msg = r.message;
    if (r.type === 'assistant' && msg) {
      if (msg.usage && msg.id && !usageById.has(msg.id)) usageById.set(msg.id, { model: msg.model ?? 'UNKNOWN', u: msg.usage });
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b.type !== 'tool_use') continue;
        toolUses.set(b.id, { name: b.name, input: b.input ?? {}, ts: r.timestamp });
        if (b.name === 'Agent' || b.name === 'Task') {
          agentCalls.push({
            id: b.id,
            type: b.input?.subagent_type ?? 'general-purpose',
            model: b.input?.model ?? 'default',
            description: redact(b.input?.description ?? ''),
            ts: r.timestamp,
          });
        }
      }
    }
    if (r.type === 'user' && Array.isArray(msg?.content)) {
      for (const b of msg.content) {
        if (b.type === 'tool_result') toolResults.set(b.tool_use_id, { ts: r.timestamp, error: b.is_error === true });
      }
    }
  }

  const models = {};
  for (const { model, u } of usageById.values()) {
    const m = (models[model] ??= { api_calls: 0, input: 0, output: 0, cache_write: 0, cache_read: 0 });
    m.api_calls += 1;
    m.input += u.input_tokens ?? 0;
    m.output += u.output_tokens ?? 0;
    m.cache_write += u.cache_creation_input_tokens ?? 0;
    m.cache_read += u.cache_read_input_tokens ?? 0;
  }
  for (const m of Object.values(models)) {
    const prompt = m.input + m.cache_write + m.cache_read;
    m.cache_hit_ratio = prompt > 0 ? Number((m.cache_read / prompt).toFixed(3)) : 'UNKNOWN';
  }

  const tools = {};
  const calls = [];
  const repeats = new Map();
  for (const [id, t] of toolUses) {
    const res = toolResults.get(id);
    const ms = res ? Date.parse(res.ts) - Date.parse(t.ts) : null;
    const s = (tools[t.name] ??= { calls: 0, errors: 0, total_ms: 0, timed: 0 });
    s.calls += 1;
    if (res?.error) s.errors += 1;
    if (ms !== null && ms >= 0) {
      s.total_ms += ms;
      s.timed += 1;
    }
    const label = preview(t.name, t.input);
    calls.push({ tool: t.name, ms, label });
    const key = `${t.name}|${JSON.stringify(t.input)}`;
    const rep = repeats.get(key) ?? { tool: t.name, label, count: 0 };
    rep.count += 1;
    repeats.set(key, rep);
  }

  return {
    window: { first: first ?? 'UNKNOWN', last: last ?? 'UNKNOWN' },
    turns: turns || 'UNKNOWN',
    turn_duration_ms: turns ? turnMs : 'UNKNOWN',
    models,
    tools,
    slowest_calls: calls
      .filter((c) => c.ms !== null)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 10),
    repeated_calls: [...repeats.values()].filter((r) => r.count > 1).sort((a, b) => b.count - a.count).slice(0, 15),
    agent_calls: agentCalls,
  };
}

/** Subagent transcripts live in <session>/subagents/agent-<id>.jsonl (+ .meta.json). */
function subagents(sessionId) {
  const dir = join(projectDir, sessionId, 'subagents');
  if (!existsSync(dir)) return { available: false, agents: [] };
  const agents = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const id = f.replace(/^agent-/, '').replace(/\.jsonl$/, '');
    const metaPath = join(dir, `agent-${id}.meta.json`);
    let meta = {};
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      // meta is optional
    }
    const a = analyse(readJsonl(join(dir, f)));
    if (a.window.first === 'UNKNOWN') continue; // outside the time window
    const tokens = Object.values(a.models).reduce((n, m) => n + m.input + m.output + m.cache_write + m.cache_read, 0);
    agents.push({
      id,
      type: meta.agentType ?? 'UNKNOWN',
      description: redact(meta.description ?? ''),
      spawn_depth: meta.spawnDepth ?? 'UNKNOWN',
      background: meta.requestShape ? meta.requestShape === 'background' : 'UNKNOWN',
      start: a.window.first,
      end: a.window.last,
      duration_ms: Date.parse(a.window.last) - Date.parse(a.window.first),
      models: a.models,
      processed_tokens: tokens,
      tool_calls: Object.values(a.tools).reduce((n, t) => n + t.calls, 0),
      ...(deep ? { tools: a.tools, slowest_calls: a.slowest_calls.slice(0, 5), repeated_calls: a.repeated_calls } : {}),
    });
  }
  return { available: true, agents };
}

/** Highest number of subagents whose [start, end] intervals overlap. */
function maxConcurrency(agents) {
  const ev = [];
  for (const a of agents) {
    ev.push([Date.parse(a.start), 1], [Date.parse(a.end), -1]);
  }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of ev) max = Math.max(max, (cur += d));
  return max;
}

const sessionId = pickSession();
const mainPath = join(projectDir, `${sessionId}.jsonl`);
if (!existsSync(mainPath)) fail(`transcript not found: ${mainPath}`);

const main = analyse(readJsonl(mainPath));
const subs = subagents(sessionId);
const report = {
  session: sessionId,
  scope: { since: opt('--since') ?? 'start', until: opt('--until') ?? 'end', deep },
  main,
  subagents: subs.available
    ? {
        count: subs.agents.length,
        max_concurrency: subs.agents.length ? maxConcurrency(subs.agents) : 0,
        nested: subs.agents.filter((a) => typeof a.spawn_depth === 'number' && a.spawn_depth > 1).length,
        agents: subs.agents,
      }
    : 'UNKNOWN (no subagents/ folder for this session)',
};

if (flag('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const lines = [`Session ${sessionId}  window ${main.window.first} → ${main.window.last}`];
  lines.push(`Turns: ${main.turns}, turn time: ${main.turn_duration_ms} ms`);
  for (const [m, s] of Object.entries(main.models)) {
    lines.push(`Model ${m}: ${s.api_calls} calls, in ${s.input}, out ${s.output}, cache write ${s.cache_write}, cache read ${s.cache_read}, hit ${s.cache_hit_ratio}`);
  }
  lines.push('Tools (calls / errors / avg ms):');
  for (const [t, s] of Object.entries(main.tools).sort((a, b) => b[1].calls - a[1].calls)) {
    lines.push(`  ${t}: ${s.calls} / ${s.errors} / ${s.timed ? Math.round(s.total_ms / s.timed) : 'UNKNOWN'}`);
  }
  lines.push('Repeated identical calls:');
  for (const r of main.repeated_calls) lines.push(`  ${r.count}× ${r.tool}: ${r.label}`);
  if (typeof report.subagents === 'string') {
    lines.push(`Subagents: ${report.subagents}`);
  } else {
    lines.push(`Subagents: ${report.subagents.count}, max concurrency ${report.subagents.max_concurrency}, nested ${report.subagents.nested}`);
    for (const a of report.subagents.agents) {
      lines.push(`  ${a.type} (${a.id}) depth ${a.spawn_depth}: ${a.duration_ms} ms, ${a.tool_calls} tool calls, ${a.processed_tokens} processed tokens — ${a.description}`);
    }
  }
  console.log(lines.join('\n'));
}
