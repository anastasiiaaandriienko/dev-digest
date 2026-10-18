import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunTrace, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { assemblePrompt, wrapUntrusted } from '@devdigest/reviewer-core';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';
import type { FindingRow } from '../src/db/rows.js';
import { ReviewRunExecutor, type Logger } from '../src/modules/reviews/run-executor.js';
import { taskLine } from '../src/modules/reviews/helpers.js';
import type { FinalizeDoneRunInput, ReviewRepository, ReviewRow } from '../src/modules/reviews/repository.js';
import { USER_OMITTED_PLACEHOLDER, placeholderLine } from '../src/modules/context/constants.js';
import { InMemoryContextStore } from './helpers/context-store.js';
import { DIFF, REVIEW_FIXTURE, agentRow, pullRow, repoRow } from './helpers/run-cost-fixtures.js';

const MARKER = 'CTX-MARKER-91c2';
const SKILL_MARKER = 'SKILL-DOC-MARKER-5d8e';
const WS = 'ws';
const REPO_ID = pullRow().repoId;
const AGENT_ID = '00000000-0000-4000-8000-0000000000a1';

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const TWO_FILE_DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;`;

const NO_SKILLS = { effectiveSkills: async () => [] } as unknown as Container['agentsRepo'];
const ONE_SKILL = {
  effectiveSkills: async () => [{ id: 'skill-1', name: 'Rules', version: 1, body: 'Check the rules.' }],
} as unknown as Container['agentsRepo'];

/** Repo fake: only what the executor calls (see run-executor-intent.test.ts). */
function fakeRepo() {
  const traces: RunTrace[] = [];
  const finalizeInputs: FinalizeDoneRunInput[] = [];
  const repo = {
    async getPrFiles() {
      return [];
    },
    async finalizeDoneRun(input: FinalizeDoneRunInput) {
      finalizeInputs.push(input);
      return {
        finalized: true as const,
        review: { id: 'review-1' } as ReviewRow,
        findings: input.findings.map((_, i) => ({ id: `f${i}` }) as FindingRow),
      };
    },
    async recordRunFailed() {
      return 'transitioned' as const;
    },
    async recordRunCancelled() {
      return 'transitioned' as const;
    },
    async getRunStatus() {
      return { status: 'running' };
    },
    async insertRunTraceIfAbsent(_runId: string, trace: RunTrace) {
      traces.push(trace);
      return true;
    },
  };
  return { repo: repo as unknown as ReviewRepository, traces, finalizeInputs };
}

/** MockLLMProvider with a hook before each call and an optional failure. */
class HookLLM extends MockLLMProvider {
  onCall?: (priorCalls: number) => Promise<void> | void;
  fail = false;
  constructor() {
    super('openai', { structured: REVIEW_FIXTURE });
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    await this.onCall?.(this.calls.filter((c) => c.method === 'completeStructured').length);
    if (this.fail) throw new Error('provider down');
    return super.completeStructured(req);
  }
}

type Msg = { role: string; content: string };
const sent = (llm: MockLLMProvider): Msg[][] =>
  llm.calls.filter((c) => c.method === 'completeStructured').map((c) => (c.req as { messages: Msg[] }).messages);

const SECTION = '## Project context\n';
/** The `## Project context` section of a user message, header included. */
function sectionOf(user: string): string {
  const start = user.indexOf(SECTION);
  const end = user.indexOf('\n\n## Diff to review', start);
  return start < 0 ? '' : user.slice(start, end);
}

let clone: string;

const writeDoc = async (rel: string, content: string): Promise<void> => {
  const full = join(clone, ...rel.split('/'));
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content);
};

beforeAll(async () => {
  clone = await realpath(await mkdtemp(join(tmpdir(), 'run-ctx-')));
  await writeDoc('docs/spec.md', `Rule one\n${MARKER}\n`);
  await writeDoc('docs/second.md', 'Second doc\n');
  await writeDoc('specs/skill.md', `Skill rule\n${SKILL_MARKER}\n`);
});

afterAll(async () => {
  await rm(clone, { recursive: true, force: true });
});

interface BuildOpts {
  llm?: HookLLM;
  diff?: string;
  clonePath?: string | null;
  paths?: string[];
  skillPaths?: string[];
  skills?: boolean;
  store?: InMemoryContextStore | null;
  body?: string | null;
  /** Agent doc paths in the order to apply via `reorderAttachments` after attaching. */
  reorderTo?: string[];
}

function build(o: BuildOpts = {}) {
  const llm = o.llm ?? new HookLLM();
  const container = new Container(config(), {} as Db, {
    secrets: new MockSecretsProvider({}),
    git: new MockGitClient({ diff: o.diff ?? DIFF }),
    llm: { openai: llm },
  });
  const store = o.store === null ? null : (o.store ?? new InMemoryContextStore());
  const fake = fakeRepo();
  const runId = randomUUID();
  const executor = new ReviewRunExecutor(
    container,
    fake.repo,
    o.skills ? ONE_SKILL : NO_SKILLS,
    undefined,
    store ?? undefined,
  );
  const logs = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  const logger: Logger = {
    info: (_o, m) => void logs.info.push(String(m)),
    warn: (_o, m) => void logs.warn.push(String(m)),
    error: (_o, m) => void logs.error.push(String(m)),
    debug: () => undefined,
  };
  const attach = async (): Promise<void> => {
    if (!store) return;
    store.addRepo(WS, REPO_ID, o.clonePath === undefined ? clone : o.clonePath);
    for (const path of o.paths ?? []) {
      await store.insertAttachment({ workspaceId: WS, owner: 'agent', ownerId: AGENT_ID, repoId: REPO_ID, path });
    }
    if (o.reorderTo) {
      const rows = await store.listAttachments(WS, 'agent', AGENT_ID, REPO_ID);
      const ids = o.reorderTo.map((p) => rows.find((r) => r.path === p)!.id);
      await store.reorderAttachments({ workspaceId: WS, owner: 'agent', ownerId: AGENT_ID, repoId: REPO_ID, ids });
    }
    for (const path of o.skillPaths ?? []) {
      await store.insertAttachment({ workspaceId: WS, owner: 'skill', ownerId: 'skill-1', repoId: REPO_ID, path });
    }
  };
  const run = async (agent: Parameters<typeof agentRow>[0] = {}) => {
    await attach();
    const job = { agent: agentRow({ id: AGENT_ID, ...agent }), runId };
    const pull = pullRow(o.body !== undefined ? { body: o.body } : {});
    const repo = repoRow(o.clonePath === null ? {} : { clonePath: o.clonePath ?? clone });
    await executor.executeRuns(WS, pull, repo, [job], logger);
    return {
      job,
      pull,
      lines: () => container.runBus.buffer(job.runId).map((e) => ({ kind: e.kind, msg: e.msg })),
    };
  };
  return { container, llm, store, logs, run, runId, ...fake };
}

const trace = (b: ReturnType<typeof build>): RunTrace => b.finalizeInputs[0]!.trace;

describe('ReviewRunExecutor — project context (trace redaction)', () => {
  it('AC-CTX-70 single-pass: marker reaches the provider; the trace passed to finalizeDoneRun has none', async () => {
    const b = build({ paths: ['docs/spec.md'] });
    await b.run({ strategy: 'single-pass' });
    const calls = sent(b.llm);
    expect(calls).toHaveLength(1);
    for (const msgs of calls) {
      expect(msgs[1]!.content).toContain(MARKER);
      expect(msgs[0]!.content).not.toContain(MARKER);
    }
    expect(b.finalizeInputs).toHaveLength(1);
    expect(JSON.stringify(trace(b))).not.toContain(MARKER);
    expect(JSON.stringify(b.finalizeInputs[0])).not.toContain(MARKER);
  });

  it('AC-CTX-70 map-reduce: marker in every chunk call; the persisted trace has none', async () => {
    const b = build({ paths: ['docs/spec.md'], diff: TWO_FILE_DIFF });
    await b.run({ strategy: 'map-reduce' });
    const calls = sent(b.llm);
    expect(calls).toHaveLength(2);
    for (const msgs of calls) {
      expect(msgs[1]!.content).toContain(MARKER);
      expect(msgs[0]!.content).not.toContain(MARKER);
    }
    expect(JSON.stringify(b.finalizeInputs[0])).not.toContain(MARKER);
  });

  it('AC-CTX-62 docs are read once, before the first call; every chunk gets the identical section', async () => {
    await writeDoc('docs/mutable.md', `Before\n${MARKER}\n`);
    const llm = new HookLLM();
    // If the doc were read per chunk, the second call would see the new text.
    llm.onCall = async (prior) => {
      if (prior === 0) await writeDoc('docs/mutable.md', 'AFTER-EDIT\n');
    };
    const b = build({ llm, paths: ['docs/mutable.md'], diff: TWO_FILE_DIFF });
    let loads = 0;
    const store = b.store!;
    const orig = store.loadForRun.bind(store);
    store.loadForRun = async (a) => {
      loads += 1;
      return orig(a);
    };
    await b.run({ strategy: 'map-reduce' });
    const [first, second] = sent(llm);
    expect(loads).toBe(1);
    expect(sectionOf(first![1]!.content)).toContain(MARKER);
    expect(sectionOf(second![1]!.content)).toBe(sectionOf(first![1]!.content));
    expect(second![1]!.content).not.toContain('AFTER-EDIT');
  });

  it('AC-CTX-71 single-pass: every part except the Project Context section is byte-identical to what was sent (TA1)', async () => {
    const b = build({ paths: ['docs/spec.md'] });
    await b.run({ strategy: 'single-pass' });
    const [msgs] = sent(b.llm);
    const t = trace(b);
    const block = t.prompt_assembly.spec_blocks![0]!;
    const placeholders = wrapUntrusted('spec-0', placeholderLine('docs/spec.md', block.tokens!, false));
    const expectedUser = msgs![1]!.content.replace(sectionOf(msgs![1]!.content), `${SECTION}${placeholders}`);
    expect(t.prompt_assembly.user).toBe(expectedUser);
    expect(t.prompt_assembly.system).toBe(msgs![0]!.content);
    expect(t.prompt_assembly.skills).toBeNull();
    expect(t.prompt_assembly.user).toContain('## Diff to review');

    // raw_output and the skills fields equal a run without context
    const base = build({});
    await base.run({ strategy: 'single-pass' });
    expect(t.raw_output).toBe(trace(base).raw_output);
    expect(t.prompt_assembly.skills).toBe(trace(base).prompt_assembly.skills);
    expect(t.prompt_assembly.skill_blocks).toEqual(trace(base).prompt_assembly.skill_blocks);
    expect(t.prompt_assembly.skills_tokens).toBe(trace(base).prompt_assembly.skills_tokens);
  });

  it('AC-CTX-71 map-reduce: persisted user equals the whole-diff assembly with only the section replaced (TA1)', async () => {
    const b = build({ paths: ['docs/spec.md'], diff: TWO_FILE_DIFF });
    const r = await b.run({ strategy: 'map-reduce' });
    const t = trace(b);
    const entry = `path: docs/spec.md\n\nRule one\n${MARKER}\n`;
    const whole = assemblePrompt({
      system: 'You are a reviewer.',
      specs: [entry],
      task: taskLine(r.pull),
      diff: TWO_FILE_DIFF,
    });
    const block = t.prompt_assembly.spec_blocks![0]!;
    const placeholders = wrapUntrusted('spec-0', placeholderLine('docs/spec.md', block.tokens!, false));
    expect(t.prompt_assembly.user).toBe(whole.assembly.user.replace(sectionOf(whole.assembly.user), `${SECTION}${placeholders}`));
    expect(t.prompt_assembly.system).toBe(whole.assembly.system);
  });

  it('AC-CTX-72 persisted specs are the per-doc placeholders; user holds the same block', async () => {
    const b = build({ paths: ['docs/spec.md', 'docs/second.md'] });
    await b.run();
    const t = trace(b);
    const [a, s] = t.prompt_assembly.spec_blocks!;
    const expected = [
      wrapUntrusted('spec-0', placeholderLine('docs/spec.md', a!.tokens!, false)),
      wrapUntrusted('spec-1', placeholderLine('docs/second.md', s!.tokens!, false)),
    ].join('\n\n');
    expect(t.prompt_assembly.specs).toBe(expected);
    expect(t.prompt_assembly.user).toContain(`${SECTION}${expected}`);
  });

  it('AC-CTX-22 the number of LLM calls is the same with or without attached docs', async () => {
    for (const [strategy, diff, calls] of [
      ['single-pass', DIFF, 1],
      ['map-reduce', TWO_FILE_DIFF, 2],
    ] as const) {
      const base = build({ diff });
      await base.run({ strategy });
      const withDocs = build({ diff, paths: ['docs/spec.md'] });
      await withDocs.run({ strategy });
      expect(sent(base.llm)).toHaveLength(calls);
      expect(sent(withDocs.llm)).toHaveLength(calls);
    }
  });

  it('AC-CTX-23 nothing attached or nothing read: the prompt equals the baseline', async () => {
    const base = build({ store: null });
    await base.run();
    const baseline = sent(base.llm);

    const none = build({});
    await none.run();
    expect(sent(none.llm)).toEqual(baseline);

    const unreadable = build({ paths: ['docs/gone.md'] });
    await unreadable.run();
    expect(sent(unreadable.llm)).toEqual(baseline);
    expect(sent(unreadable.llm)[0]![1]!.content).not.toContain('## Project context');
    expect(trace(unreadable).prompt_assembly.user).toBe(trace(base).prompt_assembly.user);
    expect(trace(unreadable).prompt_assembly.specs ?? null).toBeNull();
  });

  it('AC-CTX-20 a file changed between two runs shows the new content in the second prompt', async () => {
    await writeDoc('docs/evolving.md', 'version one\n');
    const first = build({ paths: ['docs/evolving.md'] });
    await first.run();
    await writeDoc('docs/evolving.md', 'version two\n');
    const second = build({ paths: ['docs/evolving.md'] });
    await second.run();
    expect(sent(first.llm)[0]![1]!.content).toContain('version one');
    expect(sent(second.llm)[0]![1]!.content).toContain('version two');
    expect(sent(second.llm)[0]![1]!.content).not.toContain('version one');
  });

  it('AC-CTX-33 specs_read lists the injected paths in prompt order', async () => {
    const b = build({ paths: ['docs/second.md', 'docs/gone.md', 'docs/spec.md'] });
    await b.run();
    expect(trace(b).specs_read).toEqual(['docs/second.md', 'docs/spec.md']);
    expect(trace(b).prompt_assembly.spec_summary).toMatchObject({ attached: 3, read: 2, missing: 1 });
  });

  it('AC-CTX-103 after reorder to [b, a] specs and specs_read list b before a', async () => {
    // a = docs/spec.md, b = docs/second.md; attached as [a, b], reordered to [b, a]
    const b = build({ paths: ['docs/spec.md', 'docs/second.md'], reorderTo: ['docs/second.md', 'docs/spec.md'] });
    await b.run();
    expect(trace(b).specs_read).toEqual(['docs/second.md', 'docs/spec.md']);
    const specs = trace(b).prompt_assembly.specs!;
    expect(specs.indexOf('docs/second.md')).toBeGreaterThanOrEqual(0);
    expect(specs.indexOf('docs/second.md')).toBeLessThan(specs.indexOf('docs/spec.md'));
    const user = sent(b.llm)[0]![1]!.content;
    expect(user.indexOf('path: docs/second.md')).toBeLessThan(user.indexOf('path: docs/spec.md'));
  });

  it('AC-CTX-35 specs_tokens counts "## Project context" + the specs block as sent', async () => {
    const b = build({ paths: ['docs/spec.md'] });
    await b.run();
    const section = sectionOf(sent(b.llm)[0]![1]!.content);
    expect(trace(b).prompt_assembly.specs_tokens).toBe(b.container.tokenizer.count(section));
    expect(trace(b).prompt_assembly.specs_tokens).toBeGreaterThan(0);
  });

  it('AC-CTX-36 the context log line is written before the first LLM request, without doc text', async () => {
    const llm = new HookLLM();
    const b = build({ llm, paths: ['docs/spec.md'] });
    let atFirstCall: string[] = [];
    llm.onCall = (prior) => {
      if (prior === 0) atFirstCall = b.container.runBus.buffer(b.runId).map((l) => l.msg);
    };
    await b.run();
    const line = atFirstCall.find((m) => m.startsWith('context: attached'));
    expect(line).toMatch(/^context: attached 1 doc\(s\) \(\d+ tokens\), skipped 0, truncated 0$/);
    expect(atFirstCall.some((m) => m.includes(MARKER))).toBe(false);
  });

  it('AC-CTX-75 a failing run persists a trace with no doc text', async () => {
    const llm = new HookLLM();
    llm.fail = true;
    const b = build({ llm, paths: ['docs/spec.md'] });
    await b.run();
    expect(b.finalizeInputs).toHaveLength(0);
    expect(b.traces).toHaveLength(1);
    const t = b.traces[0]!;
    expect(t.prompt_assembly.specs).toBeNull();
    expect(t.prompt_assembly.user).toBe('');
    expect(t.specs_read).toEqual([]);
    expect(JSON.stringify(t)).not.toContain(MARKER);
  });

  it('AC-CTX-38 a deleted attachment is recorded missing and the run completes', async () => {
    const b = build({ paths: ['docs/gone.md', 'docs/second.md'] });
    await b.run();
    expect(b.finalizeInputs).toHaveLength(1);
    expect(trace(b).prompt_assembly.spec_blocks![0]).toMatchObject({ path: 'docs/gone.md', status: 'missing' });
    expect(trace(b).specs_read).toEqual(['docs/second.md']);
  });

  it('AC-CTX-63 the worktree (default-branch) version is injected, not the PR version', async () => {
    const prDiff = `diff --git a/docs/spec.md b/docs/spec.md
--- a/docs/spec.md
+++ b/docs/spec.md
@@ -1,2 +1,2 @@
 Rule one
-old
+PR-VERSION-LINE`;
    const b = build({ paths: ['docs/spec.md'], diff: prDiff });
    await b.run();
    const section = sectionOf(sent(b.llm)[0]![1]!.content);
    expect(section).toContain(MARKER);
    expect(section).not.toContain('PR-VERSION-LINE');
    expect(b.finalizeInputs).toHaveLength(1);
  });

  it('AC-CTX-64 a doc that exists only in the PR head is missing and the run completes', async () => {
    const b = build({ paths: ['docs/pr-head-only.md'] });
    await b.run();
    expect(b.finalizeInputs).toHaveLength(1);
    expect(trace(b).prompt_assembly.spec_blocks![0]).toMatchObject({ status: 'missing' });
  });

  it('AC-CTX-54 no clone: every attachment skipped repo not cloned, no context section', async () => {
    const base = build({ store: null });
    await base.run();
    const b = build({ clonePath: null, paths: ['docs/spec.md'] });
    await b.run();
    expect(b.finalizeInputs).toHaveLength(1);
    expect(trace(b).prompt_assembly.spec_blocks![0]).toMatchObject({ status: 'skipped', reason: 'repo not cloned' });
    expect(sent(b.llm)).toEqual(sent(base.llm));
  });

  it('AC-CTX-54 the store throws: run completes, "context: unavailable", no error line, baseline prompt', async () => {
    const base = build({ store: null });
    await base.run();
    const store = new InMemoryContextStore();
    store.failLoad = true;
    const b = build({ store, paths: ['docs/spec.md'] });
    const r = await b.run();
    expect(b.finalizeInputs).toHaveLength(1);
    const lines = r.lines();
    expect(lines.some((l) => l.msg === 'context: unavailable' && l.kind === 'info')).toBe(true);
    expect(lines.filter((l) => l.kind === 'error')).toEqual([]);
    expect(b.logs.warn.some((m) => m.includes('project context unavailable'))).toBe(true);
    expect(sent(b.llm)).toEqual(sent(base.llm));
  });

  it('AC-CTX-16 docs attached to an applied skill are injected after the agent docs', async () => {
    const b = build({ skills: true, paths: ['docs/second.md'], skillPaths: ['specs/skill.md'] });
    await b.run();
    const user = sent(b.llm)[0]![1]!.content;
    expect(user).toContain(SKILL_MARKER);
    expect(user.indexOf('path: docs/second.md')).toBeLessThan(user.indexOf('path: specs/skill.md'));
    expect(trace(b).specs_read).toEqual(['docs/second.md', 'specs/skill.md']);
    expect(trace(b).prompt_assembly.spec_blocks![1]).toMatchObject({ source: 'skill', skill_id: 'skill-1', status: 'read' });
    expect(JSON.stringify(trace(b))).not.toContain(SKILL_MARKER);
  });

  it('AC-CTX-73 section not isolable: user persisted as the placeholder and a warning is logged', async () => {
    // A PR body that repeats a whole entry leaves doc text outside the section.
    const body = `path: docs/spec.md\n\nRule one\n${MARKER}\n`;
    const b = build({ paths: ['docs/spec.md'], body });
    const r = await b.run();
    expect(b.finalizeInputs).toHaveLength(1);
    expect(trace(b).prompt_assembly.user).toBe(USER_OMITTED_PLACEHOLDER);
    expect(trace(b).prompt_assembly.specs).not.toContain(MARKER);
    const lines = r.lines();
    expect(lines.some((l) => l.kind === 'info' && l.msg.startsWith('context: warning'))).toBe(true);
    expect(lines.filter((l) => l.kind === 'error')).toEqual([]);
    expect(b.logs.warn.some((m) => m.includes('could not be isolated'))).toBe(true);
  });
});
