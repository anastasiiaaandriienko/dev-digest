import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type {
  LLMProvider,
  PrIntentState,
  Review,
  RunTrace,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider, MockGitClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';
import type { FindingRow } from '../src/db/rows.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type {
  FinalizeDoneRunInput,
  ReviewRepository,
  ReviewRow,
} from '../src/modules/reviews/repository.js';
import { IntentService, type IntentStore } from '../src/modules/reviews/intent/service.js';
import type { IntentResolver } from '../src/modules/reviews/intent/for-run.js';
import type { IntentInputs, IntentRow, SaveIntentValues } from '../src/modules/reviews/repository/intent.repo.js';
import { CostLLMProvider, DIFF, REVIEW_FIXTURE, agentRow, pullRow, repoRow } from './helpers/run-cost-fixtures.js';

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

/** Repo fake: only what the executor calls (see run-phases.test.ts). */
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

function stateOf(over: Partial<PrIntentState> = {}, costUsd: number | null = null): PrIntentState {
  return {
    pr_id: pullRow().id,
    intent: { intent: 'Adds retry', in_scope: ['retry'], out_of_scope: ['logging'], risk_areas: ['webhooks'] },
    meta: {
      provider: 'openrouter', model: 'fake/model', prompt_version: 'v', confidence: 'high',
      generated_at: '2026-10-16T10:00:00Z', head_sha: 'sha1', input_snapshot_at: null,
      tokens_in: 10, tokens_out: 5, cost_usd: costUsd,
    },
    freshness: 'fresh',
    stale_reasons: [],
    current_model: null,
    computed: true,
    ...over,
  };
}

function fakeResolver(result: PrIntentState | null | 'throw') {
  const calls: { workspaceId: string; prId: string }[] = [];
  const resolver: IntentResolver = {
    async resolveForRun(workspaceId, prId) {
      calls.push({ workspaceId, prId });
      if (result === 'throw') throw new Error('SECRET provider failure sk-123');
      return result;
    },
  };
  return { resolver, calls };
}

function build(o: { llm?: LLMProvider; diff?: string; resolver?: IntentResolver } = {}) {
  const container = new Container(config(), {} as Db, {
    secrets: new MockSecretsProvider({}),
    git: new MockGitClient({ diff: o.diff ?? DIFF }),
    llm: { openai: o.llm ?? new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
  });
  const fake = fakeRepo();
  const executor = new ReviewRunExecutor(container, fake.repo, NO_SKILLS, o.resolver);
  const exec = (agents: Parameters<typeof agentRow>[0][]) => {
    const jobs = agents.map((a, i) => ({
      agent: agentRow({ id: `00000000-0000-4000-8000-0000000000a${i + 1}`, name: `Agent ${i + 1}`, ...a }),
      runId: randomUUID(),
    }));
    return {
      jobs,
      run: () => executor.executeRuns('ws', pullRow(), repoRow(), jobs),
      lines: (i = 0) => container.runBus.buffer(jobs[i]!.runId).map((e) => ({ kind: e.kind, msg: e.msg })),
    };
  };
  return { container, ...fake, exec };
}

const requests = (llm: MockLLMProvider) =>
  llm.calls
    .filter((c) => c.method === 'completeStructured')
    .map((c) => (c.req as { messages: { role: string; content: string }[] }).messages);

describe('ReviewRunExecutor — PR intent (L03)', () => {
  it('(a) resolves ONCE for N runs and puts the intent into every LLM call incl. map-reduce', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const { resolver, calls } = fakeResolver(stateOf());
    const b = build({ llm, diff: TWO_FILE_DIFF, resolver });
    const x = b.exec([{ strategy: 'single-pass' }, { strategy: 'map-reduce' }]);
    await x.run();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ workspaceId: 'ws', prId: pullRow().id });
    const all = requests(llm);
    expect(all).toHaveLength(3); // 1 single-pass + 2 map calls
    for (const msgs of all) expect(msgs[1]!.content).toContain('<untrusted source="pr-intent">');
    expect(b.finalizeInputs).toHaveLength(2);
    for (const f of b.finalizeInputs) expect(f.trace.prompt_assembly.intent).toContain('Summary: Adds retry');
    // both runs see the shared intent lines
    for (const i of [0, 1]) {
      expect(x.lines(i).map((l) => l.msg)).toContain('intent: attached (confidence=high, policy=conservative)');
    }
  });

  it('(b) unavailable / throwing resolver: runs finish, one info line, no error events, prompt as without resolver', async () => {
    const baseLlm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const base = build({ llm: baseLlm });
    await base.exec([{}]).run();
    const baseline = requests(baseLlm);

    for (const result of [null, 'throw'] as const) {
      const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
      const b = build({ llm, resolver: fakeResolver(result).resolver });
      const x = b.exec([{}]);
      await x.run();
      expect(b.finalizeInputs).toHaveLength(1);
      const lines = x.lines();
      expect(lines.filter((l) => l.kind === 'error')).toEqual([]);
      expect(lines.some((l) => l.msg === 'intent: unavailable — continuing without intent' && l.kind === 'info')).toBe(true);
      expect(lines.some((l) => /SECRET|sk-123/.test(l.msg))).toBe(false);
      expect(requests(llm)).toEqual(baseline);
      expect(b.finalizeInputs[0]!.trace.prompt_assembly.intent).toBeUndefined();
    }
  });

  it('all runs already cancelled: intent step skipped (no resolver call), runs end cancelled', async () => {
    const { resolver, calls } = fakeResolver(stateOf());
    const b = build({ resolver });
    const x = b.exec([{}, {}]);
    for (const j of x.jobs) b.container.runBus.cancel(j.runId);
    await x.run();
    expect(calls).toHaveLength(0);
    const lines = x.lines();
    expect(lines.some((l) => l.msg === 'intent: skipped — run cancelled' && l.kind === 'info')).toBe(true);
    expect(lines.some((l) => l.msg.startsWith('intent: resolving'))).toBe(false);
    expect(b.finalizeInputs).toHaveLength(0);
  });

  it('partially cancelled (1 of 2): resolver still called once', async () => {
    const { resolver, calls } = fakeResolver(stateOf());
    const b = build({ resolver });
    const x = b.exec([{}, {}]);
    b.container.runBus.cancel(x.jobs[0]!.runId);
    await x.run();
    expect(calls).toHaveLength(1);
    expect(b.finalizeInputs).toHaveLength(1);
  });

  it('no resolver wired: no intent lines at all', async () => {
    const b = build();
    const x = b.exec([{}]);
    await x.run();
    expect(x.lines().some((l) => l.msg.startsWith('intent:'))).toBe(false);
  });

  it('(c) run cost and tokens come only from the review LLM, even if the intent cost 5', async () => {
    const withIntent = build({ llm: new CostLLMProvider(0.002), resolver: fakeResolver(stateOf({}, 5)).resolver });
    const x = withIntent.exec([{}]);
    await x.run();
    const without = build({ llm: new CostLLMProvider(0.002) });
    await without.exec([{}]).run();

    const a = withIntent.finalizeInputs[0]!;
    const w = without.finalizeInputs[0]!;
    expect(a.trace.stats.cost_usd).toBe(0.002);
    expect(a.trace.stats.tokens_in).toBe(w.trace.stats.tokens_in);
    expect(a.trace.stats.tokens_out).toBe(w.trace.stats.tokens_out);
    expect(a.completion.tokensIn).toBe(w.completion.tokensIn);
    expect(a.completion.tokensOut).toBe(w.completion.tokensOut);
    expect(x.lines().map((l) => l.msg)).toContain(
      'intent: generated — cost 5 billed separately (not in review run cost)',
    );
  });

  it('reused stored intent is logged as a no-model-call reuse', async () => {
    const b = build({ resolver: fakeResolver(stateOf({ computed: false })).resolver });
    const x = b.exec([{}]);
    await x.run();
    expect(x.lines().map((l) => l.msg)).toContain('intent: reused stored intent (no model call)');
  });

  it('(f) the executor does not drop findings: out-of-scope SUGGESTION/style reach finalize', async () => {
    const f = REVIEW_FIXTURE.findings[0]!;
    const review: Review = {
      ...REVIEW_FIXTURE,
      findings: [
        f,
        { ...f, id: 'f-style', severity: 'SUGGESTION', category: 'style', title: 'naming nit (out of scope)' },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: review });
    const b = build({ llm, resolver: fakeResolver(stateOf()).resolver });
    await b.exec([{}]).run();
    const kept = b.finalizeInputs[0]!.findings.map((k) => k.title);
    expect(kept).toEqual(expect.arrayContaining([f.title, 'naming nit (out of scope)']));
    expect(kept).toHaveLength(2);
  });
});

// ---- with the REAL IntentService + in-memory store ---------------------------
const MODEL = { provider: 'openrouter', model: 'fake/model-a', source: 'fallback_onboarding' as const };

function inputsFor(prId: string): IntentInputs {
  return {
    pull: {
      id: prId, workspaceId: 'ws', repoId: 'r1', number: 482, title: 'Add retry', author: 'u', branch: 'b', base: 'main',
      headSha: 'sha1', lastReviewedSha: null, additions: 1, deletions: 0, filesCount: 1, status: 'needs_review',
      body: 'Body', openedAt: null, updatedAt: null,
    },
    files: [{ id: 'f1', prId, path: 'src/a.ts', additions: 1, deletions: 0, patch: '@@ -1 +1 @@ fn\n+x' }],
    snapshotAt: new Date('2026-10-16T10:00:00Z'),
  } as unknown as IntentInputs;
}

class FakeStore implements IntentStore {
  row: IntentRow | undefined;
  constructor(private inputs: IntentInputs) {}
  async getIntentRow() {
    return this.row;
  }
  async getIntentInputs() {
    return this.inputs;
  }
  async saveIntent(v: SaveIntentValues) {
    this.row = {
      prId: v.prId, intent: v.intent, inScope: v.inScope, outOfScope: v.outOfScope, riskAreas: v.riskAreas,
      confidence: v.confidence, inputFingerprint: v.inputFingerprint, promptVersion: v.promptVersion,
      provider: v.provider, model: v.model, headSha: v.headSha, inputSnapshotAt: v.inputSnapshotAt,
      generatedAt: new Date(), tokensIn: v.tokensIn, tokensOut: v.tokensOut, costUsd: v.costUsd,
    };
    return true;
  }
}

class IntentLLM implements LLMProvider {
  readonly id = 'openrouter' as const;
  calls = 0;
  async listModels(): Promise<never> {
    throw new Error('not used');
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  async embed(): Promise<never> {
    throw new Error('not used');
  }
  async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    const data = { intent: 'Adds retry', in_scope: ['retry'], out_of_scope: [], risk_areas: ['webhooks'], confidence: 'high' };
    return { data: data as T, model: 'fake/model-a', tokensIn: 10, tokensOut: 5, costUsd: 0.5, raw: '', attempts: 1 };
  }
}

function realIntent() {
  const llm = new IntentLLM();
  const store = new FakeStore(inputsFor(pullRow().id));
  const container = {
    llm: async () => llm,
    priceBook: { estimate: () => 0.01 },
    reviewRepo: store,
    auth: new MockAuthProvider(),
    get db(): never {
      throw new Error('container.db must not be used');
    },
  } as unknown as Container;
  return { llm, service: new IntentService(container, { store, pickModel: async () => MODEL }) };
}

describe('ReviewRunExecutor — PR intent with the real IntentService', () => {
  it('(d) a fresh stored intent costs 0 intent LLM calls', async () => {
    const { llm, service } = realIntent();
    await service.run('ws', pullRow().id); // generated earlier (e.g. from the PR page)
    expect(llm.calls).toBe(1);
    const reviewLlm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const b = build({ llm: reviewLlm, resolver: service });
    const x = b.exec([{}]);
    await x.run();
    expect(llm.calls).toBe(1);
    expect(x.lines().map((l) => l.msg)).toContain('intent: reused stored intent (no model call)');
    expect(requests(reviewLlm)[0]![1]!.content).toContain('<untrusted source="pr-intent">');
  });

  it('(e) two parallel executeRuns without a stored intent make exactly 1 intent LLM call', async () => {
    const { llm, service } = realIntent();
    const a = build({ resolver: service });
    const c = build({ resolver: service });
    await Promise.all([a.exec([{}]).run(), c.exec([{}]).run()]);
    expect(llm.calls).toBe(1);
    expect(a.finalizeInputs).toHaveLength(1);
    expect(c.finalizeInputs).toHaveLength(1);
    expect(a.finalizeInputs[0]!.trace.prompt_assembly.intent).toContain('Summary: Adds retry');
    expect(c.finalizeInputs[0]!.trace.prompt_assembly.intent).toContain('Summary: Adds retry');
  });
});
