import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { GitClient, RunTrace } from '@devdigest/shared';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';
import type { FindingRow } from '../src/db/rows.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type {
  FinalizeDoneRunInput,
  FinalizeDoneRunResult,
  ReviewRepository,
  ReviewRow,
} from '../src/modules/reviews/repository.js';
// The CLIENT's lifecycle-phase classifier (pure, import-free). Pinning it here
// against the messages the real executor + reviewer-core emit means a server
// wording change breaks this test instead of silently breaking the UI stepper.
import { phasesFrom } from '../../client/src/lib/run-phases.js';
import { DIFF, REVIEW_FIXTURE, agentRow, pullRow, repoRow } from './helpers/run-cost-fixtures.js';

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

type Fin = (input: FinalizeDoneRunInput) => Promise<FinalizeDoneRunResult>;

/** A repository fake: only what the executor calls. */
function fakeRepo(opts: { finalize?: Fin; prFilesError?: Error } = {}) {
  const traces: RunTrace[] = [];
  const finalizeInputs: FinalizeDoneRunInput[] = [];
  const repo = {
    async getPrFiles() {
      if (opts.prFilesError) throw opts.prFilesError;
      return [];
    },
    async finalizeDoneRun(input: FinalizeDoneRunInput) {
      finalizeInputs.push(input);
      if (opts.finalize) return opts.finalize(input);
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

/** No DB here ({} as Db): the agent has no skills linked (HW2 #14 adds this lookup). */
const NO_SKILLS = { effectiveSkills: async () => [] } as unknown as Container['agentsRepo'];

function setup(o: {
  llm?: MockLLMProvider;
  git?: GitClient;
  agent?: Parameters<typeof agentRow>[0];
  repoIntel?: unknown;
  finalize?: Fin;
  prFilesError?: Error;
} = {}) {
  const container = new Container(config(), {} as Db, {
    secrets: new MockSecretsProvider({}),
    git: o.git ?? new MockGitClient({ diff: DIFF }),
    llm: { openai: o.llm ?? new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
    ...(o.repoIntel ? { repoIntel: o.repoIntel as never } : {}),
  });
  const fake = fakeRepo({ finalize: o.finalize, prFilesError: o.prFilesError });
  const executor = new ReviewRunExecutor(container, fake.repo, NO_SKILLS);
  const runId = randomUUID();
  const lines = () => container.runBus.buffer(runId).map((e) => ({ kind: e.kind, msg: e.msg }));
  const run = () => executor.executeRuns('ws', pullRow(), repoRow(), [{ agent: agentRow(o.agent), runId }]);
  return { container, runId, run, lines, ...fake };
}

/** C/A/P/F per phase. */
const code = (r: ReturnType<typeof phasesFrom>) =>
  r.phases.map((p) => ({ pending: 'P', active: 'A', completed: 'C', skipped: 'S', failed: 'F' })[p.state]).join('');

describe('lifecycle phases from REAL executor + reviewer-core events', () => {
  it('single-pass success: every phase is observed in order; persistence is the active phase at commit time', async () => {
    let atCommit = '';
    const s = setup({
      finalize: async (input) => {
        atCommit = code(phasesFrom(s.lines(), 'running'));
        return { finalized: true, review: { id: 'r' } as ReviewRow, findings: [] as FindingRow[] };
      },
    });
    await s.run();
    expect(atCommit).toBe('CSCCA');
    const live = phasesFrom(s.lines());
    expect(live.outcome).toBe('done');
    expect(code(live)).toBe('CSCCC');
    // The persisted trace has no post-commit lines; its status completes it.
    const persisted = s.finalizeInputs[0]!.trace.log;
    expect(code(phasesFrom(persisted, 'done'))).toBe('CSCCC');
    expect(code(phasesFrom(persisted, 'running'))).toBe('CSCCA');
  });

  it('map-reduce: file progress comes from the real map events', async () => {
    let progress: unknown = null;
    const s = setup({
      git: new MockGitClient({ diff: TWO_FILE_DIFF }),
      agent: { strategy: 'map-reduce' },
      finalize: async () => {
        progress = phasesFrom(s.lines(), 'running').progress;
        return { finalized: true, review: { id: 'r' } as ReviewRow, findings: [] as FindingRow[] };
      },
    });
    await s.run();
    expect(progress).toEqual({ started: 2, total: 2 });
  });

  it('repo-intel context lines are Planning', async () => {
    const repoIntel = {
      getCallerSignatures: async () => [{ file: 'src/x.ts', symbol: 'f', signature: 'f()' }],
      getRepoMap: async () => ({ degraded: false, text: 'map', tokens: 5, cached: true }),
      getFileRank: async () => [{ path: 'src/config.ts', percentile: 99 }],
    };
    let atPlanningEnd = '';
    const s = setup({
      agent: { repoIntel: true },
      repoIntel,
      finalize: async () => {
        atPlanningEnd = code(phasesFrom(s.lines(), 'running'));
        return { finalized: true, review: { id: 'r' } as ReviewRow, findings: [] as FindingRow[] };
      },
    });
    await s.run();
    const msgs = s.lines().map((l) => l.msg);
    expect(msgs.some((m) => m.startsWith('callers digest: '))).toBe(true);
    expect(msgs.some((m) => m.startsWith('repo map: '))).toBe(true);
    expect(msgs.some((m) => m.startsWith('file rank: '))).toBe(true);
    expect(atPlanningEnd).toBe('CCCCA');
  });

  it('skipped Planning comes only from the explicit event, never from silence', async () => {
    // repo-intel ON but nothing to attach: the executor logs nothing for Planning.
    const emptyIntel = {
      getCallerSignatures: async () => [],
      getRepoMap: async () => ({ degraded: true, text: '', tokens: 0, cached: false }),
      getFileRank: async () => [],
    };
    const on = setup({ agent: { repoIntel: true }, repoIntel: emptyIntel });
    await on.run();
    expect(on.lines().some((l) => /^Repo intel disabled/.test(l.msg))).toBe(false);
    expect(code(phasesFrom(on.lines()))).toBe('CCCCC');

    // repo-intel OFF: the executor says so → Planning skipped.
    const off = setup({ agent: { repoIntel: false } });
    await off.run();
    expect(off.lines().some((l) => /^Repo intel disabled for this agent/.test(l.msg))).toBe(true);
    expect(code(phasesFrom(off.lines()))).toBe('CSCCC');
  });

  it('diff load failure → Initiation failed', async () => {
    const git = { diff: async () => { throw new Error('git down'); } } as unknown as GitClient;
    const s = setup({ git, prFilesError: new Error('db down') });
    await s.run();
    expect(code(phasesFrom(s.lines(), 'failed'))).toBe('FPPPP');
    expect(code(phasesFrom(s.lines()))).toBe('FPPPP');
  });

  it('provider failure (missing key) → Initiation failed', async () => {
    const s = setup({ agent: { provider: 'anthropic' } });
    await s.run();
    expect(s.lines().some((l) => l.kind === 'error' && /Resolving anthropic provider failed/.test(l.msg))).toBe(true);
    expect(code(phasesFrom(s.lines(), 'failed'))).toBe('FPPPP');
  });

  it('model failure → Implementation failed', async () => {
    class Failing extends MockLLMProvider {
      override async completeStructured<T>(): Promise<never> {
        throw new Error('provider down');
      }
    }
    const s = setup({ llm: new Failing('openai') });
    await s.run();
    expect(code(phasesFrom(s.lines(), 'failed'))).toBe('CSFPP');
    // The buffer trace persisted for the failed run gives the same answer.
    expect(code(phasesFrom(s.traces[0]!.log, 'failed'))).toBe('CSFPP');
  });

  it('cancelled at the model checkpoint → Implementation failed (cancelled)', async () => {
    const s = setup();
    s.container.runBus.cancel(s.runId);
    await s.run();
    const r = phasesFrom(s.lines());
    expect(r.outcome).toBe('cancelled');
    expect(code(r)).toBe('CSFPP');
    expect(r.phases[2]!.cancelled).toBe(true);
  });

  it('persistence failure after grounding → Completion failed', async () => {
    const s = setup({
      finalize: async () => {
        throw new Error('jsonb rejected');
      },
    });
    await s.run();
    expect(code(phasesFrom(s.lines(), 'failed'))).toBe('CSCCF');
  });
});
