import { describe, it, expect } from 'vitest';
import {
  buildDownstream,
  changedBaseLines,
  enclosingSymbol,
  spanTouches,
  type BlastRef,
  type SymbolSpan,
} from '../src/modules/repo-intel/blast.js';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { BFS_DEPTH, MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { BlastChangedSymbol, IndexState } from '../src/modules/repo-intel/types.js';

/**
 * HW-04 Blast Radius — the pure walk (./blast.ts) and the facade paths of
 * RepoIntelService.getBlastRadius with a stubbed repository (no Postgres).
 */

const HELPERS: BlastChangedSymbol = { file: 'src/agents/helpers.ts', name: 'toAgentDto', kind: 'function', line: 10 };

const ref = (fromPath: string, line: number, o: Partial<BlastRef> = {}): BlastRef => ({
  fromPath,
  toSymbol: HELPERS.name,
  declFile: HELPERS.file,
  line,
  rank: 0,
  ...o,
});

const base = {
  spansByFile: new Map<string, SymbolSpan[]>(),
  importEdges: [],
  factsByFile: {},
  limit: MAX_CALLERS_PER_SYMBOL,
  maxDepth: BFS_DEPTH,
};

describe('changedBaseLines / spanTouches', () => {
  // The stored patches of DevDigest PR #3 (helpers.ts and routes.ts), verbatim hunks.
  const HELPERS_PATCH = [
    '@@ -16,13 +16,14 @@ export function toAgentDto(row: AgentRow): Agent {',
    '     description: row.description,',
    '     provider: row.provider as Provider,',
    '     model: row.model,',
    '-    system_prompt: row.systemPrompt,',
    '+    instructions: row.systemPrompt,',
    '     output_schema: row.outputSchema ?? null,',
    '     enabled: row.enabled,',
    '     version: row.version,',
    '     strategy: row.strategy as ReviewStrategy,',
    '     ci_fail_on: row.ciFailOn as CiFailOn,',
    '     repo_intel: row.repoIntel,',
    '+    created_at: row.createdAt.toISOString(),',
    '   };',
    ' }',
    ' ',
  ].join('\n');
  const ROUTES_PATCH = [
    '@@ -21,7 +21,7 @@ const VersionParams = z.object({',
    ' *   GET    /agents',
    ' *   GET    /agents/:id',
    ' *   POST   /agents',
    '- *   PUT    /agents/:id',
    '+ *   PATCH  /agents/:id',
    ' *   GET    /agents/:id/versions',
    ' *   GET    /agents/:id/versions/:version',
    ' *   GET    /agents/:id/skills',
    '@@ -106,7 +106,7 @@ export default async function agentsRoutes(appBase: FastifyInstance) {',
    '     return agent;',
    '   });',
    ' ',
    '-  app.put(',
    '+  app.patch(',
    "     '/agents/:id',",
  ].join('\n');

  it('returns the base lines a patch changes: deletions and the line an insertion follows', () => {
    // 16 description … 19 (deleted system_prompt) … 25 repo_intel, then the created_at insertion.
    expect(changedBaseLines(HELPERS_PATCH)).toEqual([19, 25]);
    expect(changedBaseLines(ROUTES_PATCH)).toEqual([24, 109]);
  });

  it('ignores context, the no-newline marker, and anchors a top-of-file insertion at line 1', () => {
    expect(changedBaseLines('@@ -1,2 +1,3 @@\n+import x;\n a\n b\n\\ No newline at end of file')).toEqual([1]);
    expect(changedBaseLines('@@ -0,0 +1,2 @@\n+a\n+b')).toEqual([1]);
    expect(changedBaseLines('not a patch')).toEqual([]);
  });

  it('a span touches a changed line only when it contains it', () => {
    // helpers.ts spans of PR #3: only toAgentDto (12–27) overlaps [19, 25].
    const lines = changedBaseLines(HELPERS_PATCH);
    expect(spanTouches({ line: 12, endLine: 27 }, lines)).toBe(true);
    expect(spanTouches({ line: 35, endLine: 42 }, lines)).toBe(false);
    expect(spanTouches({ line: 61, endLine: 86 }, lines)).toBe(false);
    expect(spanTouches({ line: 19, endLine: null }, lines)).toBe(true); // unknown end → first line only
    expect(spanTouches({ line: null, endLine: null }, lines)).toBe(false);
  });
});

describe('enclosingSymbol', () => {
  const spans: SymbolSpan[] = [
    { name: 'AgentsService', line: 1, endLine: 50 },
    { name: 'list', line: 10, endLine: 20 },
    { name: 'AgentsService.list', line: 10, endLine: 20 },
    { name: 'get', line: 22, endLine: 30 },
  ];

  it('returns the innermost bare-name symbol containing the line', () => {
    expect(enclosingSymbol(spans, 15)).toBe('list');
    expect(enclosingSymbol(spans, 40)).toBe('AgentsService');
  });

  it('returns null at module scope and treats an unknown end as open-ended', () => {
    expect(enclosingSymbol(spans, 60)).toBeNull();
    expect(enclosingSymbol([{ name: 'legacy', line: 3, endLine: null }], 90)).toBe('legacy');
  });
});

describe('buildDownstream', () => {
  it('lists 2+ callers with file:line and the endpoints registered in their files', () => {
    const [impact] = buildDownstream({
      ...base,
      changedSymbols: [HELPERS],
      refs: [ref('src/agents/service.ts', 62, { rank: 0.4 }), ref('src/agents/repository.ts', 163, { rank: 0.2 })],
      spansByFile: new Map([
        ['src/agents/service.ts', [{ name: 'list', line: 60, endLine: 70 }]],
        ['src/agents/repository.ts', [{ name: 'insert', line: 150, endLine: 170 }]],
      ]),
      factsByFile: { 'src/agents/service.ts': { endpoints: ['GET /agents'], crons: [] } },
    });

    expect(impact!.callers).toEqual([
      { file: 'src/agents/service.ts', symbol: 'list', viaSymbol: 'toAgentDto', line: 62, rank: 0.4 },
      { file: 'src/agents/repository.ts', symbol: 'insert', viaSymbol: 'toAgentDto', line: 163, rank: 0.2 },
    ]);
    expect(impact!.callerCount).toBe(2);
    expect(impact!.endpoints).toEqual(['GET /agents']);
  });

  it('never lists the defining file as a caller', () => {
    const [impact] = buildDownstream({
      ...base,
      changedSymbols: [HELPERS],
      refs: [ref(HELPERS.file, 30), ref('src/agents/service.ts', 62)],
    });
    expect(impact!.callers.map((c) => c.file)).toEqual(['src/agents/service.ts']);
  });

  it('reaches endpoints/crons through importers up to BFS_DEPTH=2, not beyond', () => {
    const [impact] = buildDownstream({
      ...base,
      changedSymbols: [HELPERS],
      refs: [ref('src/agents/service.ts', 62)],
      importEdges: [
        { fromFile: 'src/agents/routes.ts', toFile: 'src/agents/service.ts' }, // depth 2
        { fromFile: 'src/jobs/sync.ts', toFile: 'src/agents/service.ts' }, // depth 2
        { fromFile: 'src/modules/index.ts', toFile: 'src/agents/routes.ts' }, // depth 3
        { fromFile: HELPERS.file, toFile: 'src/agents/service.ts' }, // defining file: skipped
      ],
      factsByFile: {
        'src/agents/routes.ts': { endpoints: ['POST /agents', 'GET /agents'], crons: [] },
        'src/jobs/sync.ts': { endpoints: [], crons: ['job:sync_agents'] },
        'src/modules/index.ts': { endpoints: ['GET /too-far'], crons: [] },
        [HELPERS.file]: { endpoints: ['GET /defining-file'], crons: [] },
      },
    });

    expect(impact!.endpoints).toEqual(['GET /agents', 'POST /agents']);
    expect(impact!.crons).toEqual(['job:sync_agents']);
    // Depth-2 files only widen the impact; callers stay the direct call sites.
    expect(impact!.callers.map((c) => c.file)).toEqual(['src/agents/service.ts']);
  });

  it('ignores endpoints/crons of test files (their inject() calls are not routes)', () => {
    const [impact] = buildDownstream({
      ...base,
      changedSymbols: [HELPERS],
      refs: [ref('src/agents/service.ts', 62), ref('server/test/agents.it.test.ts', 9)],
      importEdges: [{ fromFile: 'test/routes.spec.ts', toFile: 'src/agents/service.ts' }],
      factsByFile: {
        'src/agents/service.ts': { endpoints: ['GET /agents'], crons: [] },
        'server/test/agents.it.test.ts': { endpoints: ['GET /agents/${id}'], crons: ['job:test'] },
        'test/routes.spec.ts': { endpoints: ['POST /from-spec'], crons: [] },
      },
    });
    expect(impact!.endpoints).toEqual(['GET /agents']);
    expect(impact!.crons).toEqual([]);
    // A test is still a real caller of the symbol.
    expect(impact!.callerCount).toBe(2);
  });

  it('caps callers at MAX_CALLERS_PER_SYMBOL per symbol and reports the full count', () => {
    const other: BlastChangedSymbol = { file: 'src/b.ts', name: 'other', kind: 'function', line: 1 };
    const refs = [
      ...Array.from({ length: 25 }, (_, i) => ref(`src/callers/c${String(i).padStart(2, '0')}.ts`, 5, { rank: i })),
      ...Array.from({ length: 3 }, (_, i) =>
        ref(`src/other/o${i}.ts`, 1, { toSymbol: 'other', declFile: 'src/b.ts' }),
      ),
    ];
    const [helpers, otherImpact] = buildDownstream({ ...base, changedSymbols: [HELPERS, other], refs });

    expect(MAX_CALLERS_PER_SYMBOL).toBe(20);
    expect(helpers!.callers).toHaveLength(20);
    expect(helpers!.callerCount).toBe(25);
    expect(helpers!.callers[0]!.rank).toBe(24); // best-ranked first
    // The cap is per symbol: the second symbol keeps all of its callers.
    expect(otherImpact!.callers).toHaveLength(3);
  });

  it('dedupes call sites per (file, enclosing symbol) and orders deterministically', () => {
    const refs = [ref('src/z.ts', 9), ref('src/a.ts', 7), ref('src/a.ts', 3), ref('src/m.ts', 1)];
    const run = (r: BlastRef[]) => buildDownstream({ ...base, changedSymbols: [HELPERS], refs: r })[0]!.callers;

    expect(run(refs).map((c) => `${c.file}:${c.line}`)).toEqual(['src/a.ts:3', 'src/m.ts:1', 'src/z.ts:9']);
    expect(run([...refs].reverse())).toEqual(run(refs));
  });

  it('attributes references to the right symbol when two changed files declare the same name', () => {
    const twin: BlastChangedSymbol = { ...HELPERS, file: 'src/legacy/helpers.ts' };
    const [a, b] = buildDownstream({
      ...base,
      changedSymbols: [HELPERS, twin],
      refs: [ref('src/one.ts', 1), ref('src/two.ts', 2, { declFile: twin.file })],
    });
    expect(a!.callers.map((c) => c.file)).toEqual(['src/one.ts']);
    expect(b!.callers.map((c) => c.file)).toEqual(['src/two.ts']);
  });
});

// ---------------------------------------------------------------------------
// Facade paths (stubbed repository).
// ---------------------------------------------------------------------------

function state(status: IndexState['status']): IndexState {
  return {
    repoId: 'r1',
    status,
    filesIndexed: 3,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: 'indexedsha123',
    indexerVersion: 2,
    updatedAt: new Date(0),
  };
}

function service(opts: {
  flag?: boolean;
  indexState?: IndexState | null;
  clonePath?: string | null;
  codeIndex?: { symbols: () => Promise<unknown[]>; references: () => Promise<unknown[]> };
}) {
  const calls: string[] = [];
  const container = {
    config: { repoIntelEnabled: opts.flag ?? true },
    db: {} as never,
    git: { currentHead: async () => 'cloneheadsha' },
    codeIndex: opts.codeIndex ?? { symbols: async () => [], references: async () => [] },
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => opts.indexState ?? null,
    getRepoBasics: async () => ({ id: 'r1', owner: 'acme', name: 'api', clonePath: opts.clonePath ?? null }),
    getSymbolRows: async (_r: string, paths: string[]) => {
      calls.push(`symbols:${paths.join(',')}`);
      const rows = [
        { path: 'src/helpers.ts', name: 'toDto', kind: 'function', line: 3, endLine: 9, exported: true, signature: null },
        { path: 'src/service.ts', name: 'list', kind: 'method', line: 10, endLine: 20, exported: false, signature: null },
      ];
      return rows.filter((r) => paths.includes(r.path));
    },
    getResolvedCallers: async () => [
      { fromPath: 'src/service.ts', toSymbol: 'toDto', declFile: 'src/helpers.ts', line: 12, rank: 0.5 },
      { fromPath: 'src/helpers.ts', toSymbol: 'toDto', declFile: 'src/helpers.ts', line: 8, rank: 0.9 },
    ],
    getImporters: async (_r: string, files: string[]) => {
      calls.push(`importers:${files.join(',')}`);
      return files.includes('src/service.ts') ? [{ fromFile: 'src/routes.ts', toFile: 'src/service.ts' }] : [];
    },
    getFileFacts: async () => [{ filePath: 'src/routes.ts', endpoints: ['GET /items'], crons: ['job:poll'] }],
  };
  return { svc, calls };
}

describe('RepoIntelService.getBlastRadius', () => {
  it('full index → precise, not degraded, pinned to the indexed SHA', async () => {
    const { svc, calls } = service({ indexState: state('full') });
    const r = await svc.getBlastRadius('r1', ['src/helpers.ts']);

    expect(r.degraded).toBe(false);
    expect(r.reason).toBeUndefined();
    expect(r.ref).toBe('indexedsha123');
    expect(r.changedSymbols).toEqual([{ file: 'src/helpers.ts', name: 'toDto', kind: 'function', line: 3 }]);
    expect(r.downstream[0]!.callers).toEqual([
      { file: 'src/service.ts', symbol: 'list', viaSymbol: 'toDto', line: 12, rank: 0.5 },
    ]);
    expect(r.downstream[0]!.endpoints).toEqual(['GET /items']);
    expect(r.downstream[0]!.crons).toEqual(['job:poll']);
    expect(r.impactedEndpoints).toEqual(['GET /items']);
    // One reverse hop (BFS_DEPTH = 2): importers of the depth-1 caller file only.
    expect(calls.filter((c) => c.startsWith('importers:'))).toEqual(['importers:src/service.ts']);
  });

  it('changedLines keeps only symbols whose span overlaps a changed line; a file without an entry keeps all', async () => {
    const touched = await service({ indexState: state('full') }).svc.getBlastRadius('r1', ['src/helpers.ts'], {
      'src/helpers.ts': [5],
    });
    expect(touched.changedSymbols.map((s) => s.name)).toEqual(['toDto']);
    expect(touched.downstream[0]!.callers).toHaveLength(1);

    const untouched = await service({ indexState: state('full') }).svc.getBlastRadius('r1', ['src/helpers.ts'], {
      'src/helpers.ts': [40],
    });
    expect(untouched).toMatchObject({ changedSymbols: [], downstream: [], callers: [], degraded: false });

    const noEntry = await service({ indexState: state('full') }).svc.getBlastRadius('r1', ['src/helpers.ts'], {
      'src/other.ts': [1],
    });
    expect(noEntry.changedSymbols.map((s) => s.name)).toEqual(['toDto']);
  });

  it('partial index → same walk, degraded index_partial', async () => {
    const { svc } = service({ indexState: state('partial') });
    const r = await svc.getBlastRadius('r1', ['src/helpers.ts']);
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe('index_partial');
    expect(r.downstream[0]!.callers).toHaveLength(1);
  });

  it('flag off → empty, degraded flag_off', async () => {
    const { svc } = service({ flag: false, indexState: state('full') });
    const r = await svc.getBlastRadius('r1', ['src/helpers.ts']);
    expect(r).toMatchObject({ changedSymbols: [], downstream: [], degraded: true, reason: 'flag_off', ref: '' });
  });

  it('no changed files → empty and not degraded', async () => {
    const { svc } = service({ indexState: state('full') });
    const r = await svc.getBlastRadius('r1', []);
    expect(r).toMatchObject({ changedSymbols: [], downstream: [], degraded: false });
  });

  it('no index and no clone → empty, degraded no_data; failed index → index_failed', async () => {
    expect(await service({}).svc.getBlastRadius('r1', ['a.ts'])).toMatchObject({ degraded: true, reason: 'no_data' });
    expect(await service({ indexState: state('failed') }).svc.getBlastRadius('r1', ['a.ts'])).toMatchObject({
      degraded: true,
      reason: 'index_failed',
    });
  });

  it('no index → ripgrep fallback: depth 1, rank 0, degraded, pinned to the clone HEAD', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const clone = await mkdtemp(join(tmpdir(), 'blast-fallback-'));
    await mkdir(join(clone, 'src'), { recursive: true });
    await writeFile(join(clone, 'src', 'routes.ts'), "app.get('/items', h);\ncron.schedule('*/5 * * * *', h);\n");
    try {
      const { svc } = service({
        clonePath: clone,
        codeIndex: {
          symbols: async () => [
            { path: 'src/helpers.ts', name: 'toDto', kind: 'function', line: 3 },
            { path: 'src/routes.ts', name: 'register', kind: 'function', line: 1 },
          ],
          references: async () => [
            { fromPath: 'src/routes.ts', toSymbol: 'toDto', line: 1 },
            { fromPath: 'src/helpers.ts', toSymbol: 'toDto', line: 5 },
          ],
        },
      });
      const r = await svc.getBlastRadius('r1', ['src/helpers.ts']);

      expect(r).toMatchObject({ degraded: true, reason: 'no_data', ref: 'cloneheadsha' });
      expect(r.downstream[0]!.callers).toEqual([
        { file: 'src/routes.ts', symbol: 'register', viaSymbol: 'toDto', line: 1, rank: 0 },
      ]);
      expect(r.downstream[0]!.endpoints).toEqual(['GET /items']);
      expect(r.downstream[0]!.crons).toEqual(['*/5 * * * *']);
    } finally {
      await rm(clone, { recursive: true, force: true });
    }
  });
});
