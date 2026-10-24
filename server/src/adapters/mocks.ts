import type { z } from 'zod';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  Embedder,
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  CommitIfUnchangedPayload,
  CommitIfUnchangedResult,
  RepoDirEntry,
  WorkflowRunMeta,
  WorkflowRunArtifact,
  GitClient,
  CloneOptions,
  UnifiedDiff,
  BlameLine,
  GitCommit,
  CodeIndex,
  CodeMatch,
  CodeSymbol,
  CodeReference,
  AuthProvider,
  AuthUser,
  AuthWorkspace,
  SecretsProvider,
  SecretKey,
} from '@devdigest/shared';
import { parseUnifiedDiff } from './git/diff-parser.js';
import { assertCommitPaths, GitHubAdapterError } from './github/errors.js';

/**
 * Deterministic MOCK adapters for tests/dev — NO real network. Each mirrors the
 * adapter interface. The mock LLM returns a caller-supplied fixture (or a default)
 * for completeStructured, so review/grounding flows can be tested end-to-end.
 */

// ---------- Mock LLM ----------
export interface MockLLMOptions {
  models?: ModelInfo[];
  /** Fixture returned by completeStructured (validated against the schema). */
  structured?: unknown;
  /**
   * Per-schemaName fixtures for multi-call flows (e.g. the conventions 2-step
   * dialogue: 'ConventionFileSelection' then 'ConventionExtraction'). Looked up
   * by req.schemaName; falls back to `structured` when no entry matches.
   */
  structuredBySchema?: Record<string, unknown>;
  completionText?: string;
  embedding?: number[];
}

export class MockLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic';
  public calls: { method: string; req: unknown }[] = [];

  constructor(
    id: 'openai' | 'anthropic' = 'openai',
    private opts: MockLLMOptions = {},
  ) {
    this.id = id;
  }

  async listModels(): Promise<ModelInfo[]> {
    this.calls.push({ method: 'listModels', req: null });
    return (
      this.opts.models ?? [
        { id: 'gpt-4.1', provider: this.id === 'anthropic' ? 'anthropic' : 'openai' },
      ]
    );
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push({ method: 'complete', req });
    return {
      text: this.opts.completionText ?? 'mock completion',
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
    };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    const fixture = this.opts.structuredBySchema?.[req.schemaName] ?? this.opts.structured ?? {};
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    if (!parsed.success) {
      throw new Error(`MockLLMProvider fixture failed schema: ${parsed.error.message}`);
    }
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push({ method: 'embed', req: texts });
    return texts.map(() => this.opts.embedding ?? new Array(1536).fill(0));
  }
}

// ---------- Mock Embedder ----------
export class MockEmbedder implements Embedder {
  readonly dims = 1536;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((_, i) => new Array(1536).fill(0).map((_, j) => (i + j) % 2));
  }
}

// ---------- Mock GitHub ----------
export interface MockGitHubOptions {
  pulls?: PrMeta[];
  detail?: Partial<PrDetail>;
  login?: string;
  /** Existing inline review comments returned by listReviewComments. */
  comments?: PrReviewComment[];
  // ---- Export to CI (L07) ----
  /** Returned by getDefaultBranch (default "main"). */
  defaultBranch?: string;
  /** Branch heads: branch name → commit SHA (a missing key = no such branch). */
  branches?: Record<string, string>;
  /** Repository files per commit SHA: path → UTF-8 contents. */
  trees?: Record<string, Record<string, string>>;
  /** Returned by listWorkflowRuns as configured (sliced to perPage). */
  workflowRuns?: WorkflowRunMeta[];
  /** Run id → its artifacts. */
  runArtifacts?: Record<number, WorkflowRunArtifact[]>;
  /** Artifact id → zip bytes (a missing key → 404). */
  artifactZips?: Record<number, Uint8Array>;
  /** Make an L07 method reject with this HTTP status, e.g. `{ listWorkflowRuns: 401 }`. */
  failWith?: Partial<Record<MockGitHubCiMethod, number>>;
  /**
   * Called inside commitFilesIfUnchanged right before the compare-and-swap:
   * tests call `gh.moveBranch(...)` here to simulate a concurrent push.
   */
  beforeRefWrite?: (gh: MockGitHubClient) => void;
}

export type MockGitHubCiMethod =
  | 'getDefaultBranch'
  | 'getBranchHeadSha'
  | 'listDirectory'
  | 'readFile'
  | 'commitFilesIfUnchanged'
  | 'listWorkflowRuns'
  | 'listRunArtifacts'
  | 'downloadArtifact';

export class MockGitHubClient implements GitHubClient {
  public posted: { n: number; review: GitHubReviewPayload }[] = [];
  public openedPrs: OpenPrPayload[] = [];
  public committed: CommitFilesPayload[] = [];
  public createdComments: CreateReviewCommentInput[] = [];
  /** Every call, in order (method + arguments) — lets tests assert "no GitHub call". */
  public calls: { method: string; args: unknown[] }[] = [];
  /** Successful compare-and-swap commits. */
  public casCommits: (CommitIfUnchangedPayload & { commitSha: string })[] = [];
  /** Live branch heads and trees (seeded from the options, changed by commits). */
  public branches: Record<string, string>;
  public trees: Record<string, Record<string, string>>;

  constructor(private opts: MockGitHubOptions = {}) {
    this.branches = { ...(opts.branches ?? {}) };
    this.trees = Object.fromEntries(
      Object.entries(opts.trees ?? {}).map(([sha, files]) => [sha, { ...files }]),
    );
  }

  /** Move (or with null, delete) a branch — e.g. a concurrent push. */
  moveBranch(branch: string, sha: string | null): void {
    if (sha === null) delete this.branches[branch];
    else this.branches[branch] = sha;
  }

  private track(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
  }

  private trackCi(method: MockGitHubCiMethod, args: unknown[]): void {
    this.track(method, args);
    const status = this.opts.failWith?.[method];
    if (status != null) throw new GitHubAdapterError(`mock GitHub ${method} failed: HTTP ${status}`, status);
  }

  async listPullRequests(_repo: RepoRef): Promise<PrMeta[]> {
    this.track('listPullRequests', [_repo]);
    return (
      this.opts.pulls ?? [
        {
          number: 482,
          title: 'Add rate limiting to public API endpoints',
          author: 'marisa.koch',
          branch: 'feat/rate-limit-public',
          base: 'main',
          head_sha: 'a1b2c3d4',
          additions: 247,
          deletions: 38,
          files_count: 9,
          status: 'open',
          opened_at: '2026-06-01T00:00:00Z',
          updated_at: '2026-06-01T03:00:00Z',
        },
      ]
    );
  }

  async getPullRequest(_repo: RepoRef, n: number): Promise<PrDetail> {
    this.track('getPullRequest', [_repo, n]);
    const base: PrDetail = {
      number: n,
      title: 'Add rate limiting to public API endpoints',
      author: 'marisa.koch',
      branch: 'feat/rate-limit-public',
      base: 'main',
      head_sha: 'a1b2c3d4',
      additions: 247,
      deletions: 38,
      files_count: 9,
      status: 'open',
      body: 'Add rate limiting. Closes #471.',
      files: [
        {
          path: 'src/config.ts',
          additions: 4,
          deletions: 0,
          patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
        },
      ],
      commits: [
        { sha: 'a1b2c3d4', message: 'Add limiter', author: 'marisa.koch', committed_at: null },
      ],
      linked_issue: null,
    };
    return { ...base, ...this.opts.detail };
  }

  async postReview(_repo: RepoRef, n: number, review: GitHubReviewPayload): Promise<{ id: string }> {
    this.track('postReview', [_repo, n, review]);
    this.posted.push({ n, review });
    return { id: `mock-review-${n}` };
  }

  async listReviewComments(_repo: RepoRef, _n: number): Promise<PrReviewComment[]> {
    this.track('listReviewComments', [_repo, _n]);
    return this.opts.comments ?? [];
  }

  async createReviewComment(
    _repo: RepoRef,
    _n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    this.track('createReviewComment', [_repo, _n, input]);
    this.createdComments.push(input);
    return {
      id: this.createdComments.length,
      path: input.path,
      line: input.line,
      original_line: input.line,
      side: input.side ?? 'RIGHT',
      body: input.body,
      user: this.opts.login ?? 'mock-user',
      created_at: '2026-06-01T00:00:00Z',
      html_url: `https://github.com/mock/mock/pull/1#discussion_r${this.createdComments.length}`,
      in_reply_to_id: input.inReplyTo ?? null,
      is_outdated: false,
    };
  }

  async openPullRequest(_repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    this.track('openPullRequest', [_repo, payload]);
    this.openedPrs.push(payload);
    return { url: 'https://github.com/mock/mock/pull/1' };
  }

  async commitFiles(_repo: RepoRef, payload: CommitFilesPayload): Promise<{ branch: string }> {
    this.track('commitFiles', [_repo, payload]);
    this.committed.push(payload);
    return { branch: payload.branch };
  }

  async findOpenPr(_repo: RepoRef, branch: string): Promise<{ url: string; base: string } | null> {
    this.track('findOpenPr', [_repo, branch]);
    const pr = this.openedPrs.find((p) => p.head === branch);
    return pr ? { url: 'https://github.com/mock/mock/pull/1', base: pr.base } : null;
  }

  async getIssue(_repo: RepoRef, n: number): Promise<IssueMeta> {
    this.track('getIssue', [_repo, n]);
    return { number: n, title: `Issue #${n}`, body: 'mock issue', state: 'open' };
  }

  async currentLogin(): Promise<string> {
    this.track('currentLogin', []);
    return this.opts.login ?? 'mock-user';
  }

  // ---- Export to CI (L07): an in-memory repo of branches → commit trees ----

  async getDefaultBranch(repo: RepoRef): Promise<string> {
    this.trackCi('getDefaultBranch', [repo]);
    return this.opts.defaultBranch ?? 'main';
  }

  async getBranchHeadSha(repo: RepoRef, branch: string): Promise<string | null> {
    this.trackCi('getBranchHeadSha', [repo, branch]);
    return this.branches[branch] ?? null;
  }

  async listDirectory(repo: RepoRef, path: string, sha: string): Promise<RepoDirEntry[]> {
    this.trackCi('listDirectory', [repo, path, sha]);
    const files = this.trees[sha] ?? {};
    const dir = path.replace(/\/+$/, '');
    if (dir in files) throw new GitHubAdapterError(`Not a directory: ${path}`, 422);
    const entries = new Map<string, RepoDirEntry>();
    for (const file of Object.keys(files)) {
      if (!file.startsWith(`${dir}/`)) continue;
      const [name, ...rest] = file.slice(dir.length + 1).split('/');
      const type = rest.length > 0 ? 'dir' : 'file';
      entries.set(name!, { name: name!, path: `${dir}/${name}`, type });
    }
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async readFile(repo: RepoRef, path: string, sha: string): Promise<string | null> {
    this.trackCi('readFile', [repo, path, sha]);
    const files = this.trees[sha] ?? {};
    if (path in files) return files[path]!;
    if (Object.keys(files).some((f) => f.startsWith(`${path}/`))) {
      throw new GitHubAdapterError(`Not a file: ${path}`, 422);
    }
    return null;
  }

  async commitFilesIfUnchanged(
    repo: RepoRef,
    payload: CommitIfUnchangedPayload,
  ): Promise<CommitIfUnchangedResult> {
    this.trackCi('commitFilesIfUnchanged', [repo, payload]);
    assertCommitPaths(payload.files);
    this.opts.beforeRefWrite?.(this);
    const current = this.branches[payload.branch] ?? null;
    if (current !== payload.expectedHeadSha) return { ok: false, reason: 'ref_changed' };
    const parent = payload.expectedHeadSha ?? payload.baseSha;
    const commitSha = `mock-commit-${this.casCommits.length + 1}`;
    this.trees[commitSha] = {
      ...(this.trees[parent] ?? {}),
      ...Object.fromEntries(payload.files.map((f) => [f.path, f.contents])),
    };
    this.branches[payload.branch] = commitSha;
    this.casCommits.push({ ...payload, commitSha });
    return { ok: true, commitSha };
  }

  async listWorkflowRuns(
    repo: RepoRef,
    workflowFile: string,
    opts: { perPage: number },
  ): Promise<WorkflowRunMeta[]> {
    this.trackCi('listWorkflowRuns', [repo, workflowFile, opts]);
    return (this.opts.workflowRuns ?? []).slice(0, opts.perPage);
  }

  async listRunArtifacts(repo: RepoRef, runId: number): Promise<WorkflowRunArtifact[]> {
    this.trackCi('listRunArtifacts', [repo, runId]);
    return this.opts.runArtifacts?.[runId] ?? [];
  }

  async downloadArtifact(
    repo: RepoRef,
    artifactId: number,
    opts: { maxBytes: number },
  ): Promise<Uint8Array> {
    this.trackCi('downloadArtifact', [repo, artifactId, opts]);
    const bytes = this.opts.artifactZips?.[artifactId];
    if (!bytes) throw new GitHubAdapterError(`mock GitHub artifact ${artifactId} not found`, 404);
    if (bytes.byteLength > opts.maxBytes) {
      throw new GitHubAdapterError(`Artifact larger than ${opts.maxBytes} bytes`, 413);
    }
    return bytes;
  }
}

// ---------- Mock Git ----------
export interface MockGitOptions {
  diff?: string;
  files?: Record<string, string>;
  /** Name-only diff result (drives the incremental indexer's "changed files since X" path). */
  diffNameOnly?: string[];
  /** Override `currentHead()` so tests can simulate "sha unchanged since last index". */
  head?: string;
  /** Head `currentHead()` returns AFTER `sync()` runs — simulates fetch+reset advancing HEAD. */
  syncedHead?: string;
}

export class MockGitClient implements GitClient {
  public cloned: { repo: RepoRef; url: string }[] = [];
  public syncs: { repo: RepoRef; branch: string }[] = [];
  private syncedHead?: string;

  constructor(private opts: MockGitOptions = {}) {}

  clonePathFor(repo: RepoRef): string {
    return `/mock/clones/${repo.owner}/${repo.name}`;
  }
  async clone(repo: RepoRef, url: string, _opts?: CloneOptions): Promise<{ path: string }> {
    this.cloned.push({ repo, url });
    return { path: this.clonePathFor(repo) };
  }
  async fetchPullHead(): Promise<void> {}
  async sync(repo: RepoRef, branch: string): Promise<{ head: string }> {
    this.syncs.push({ repo, branch });
    // After a sync, HEAD advances to syncedHead (or stays at head if unset).
    this.syncedHead = this.opts.syncedHead ?? this.opts.head ?? 'a1b2c3d4';
    return { head: this.syncedHead };
  }
  async currentHead(): Promise<string> {
    return this.syncedHead ?? this.opts.head ?? 'a1b2c3d4';
  }
  async diffNameOnly(): Promise<string[]> {
    return this.opts.diffNameOnly ?? [];
  }
  async diff(): Promise<UnifiedDiff> {
    const raw =
      this.opts.diff ??
      'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';
    return parseUnifiedDiff(raw);
  }
  async blame(): Promise<BlameLine[]> {
    return [{ line: 1, sha: 'a1b2c3d4', author: 'marisa.koch', date: '2026-06-01', summary: 'init' }];
  }
  async log(): Promise<GitCommit[]> {
    return [{ sha: 'a1b2c3d4', message: 'init', author: 'marisa.koch', date: '2026-06-01' }];
  }
  async readFile(_repo: RepoRef, path: string): Promise<string> {
    return this.opts.files?.[path] ?? '';
  }
}

// ---------- Mock CodeIndex ----------
export class MockCodeIndex implements CodeIndex {
  async grep(_repo: RepoRef, pattern: string): Promise<CodeMatch[]> {
    return [{ path: 'src/config.ts', line: 12, text: `match for ${pattern}` }];
  }
  async symbols(): Promise<CodeSymbol[]> {
    return [{ path: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function', line: 25 }];
  }
  async references(_repo: RepoRef, symbol: string): Promise<CodeReference[]> {
    return [{ fromPath: 'src/api/public/index.ts', toSymbol: symbol, line: 23 }];
  }
}

// ---------- Mock Auth / Secrets ----------
export class MockAuthProvider implements AuthProvider {
  constructor(
    private user: AuthUser = { id: 'u1', email: 'you@local', name: 'You' },
    private workspace: AuthWorkspace = { id: 'w1', name: 'default' },
  ) {}
  async currentUser(): Promise<AuthUser> {
    return this.user;
  }
  async currentWorkspace(): Promise<AuthWorkspace> {
    return this.workspace;
  }
}

export class MockSecretsProvider implements SecretsProvider {
  constructor(private secrets: Partial<Record<string, string>> = {}) {}
  async get(key: SecretKey): Promise<string | undefined> {
    return this.secrets[key as string];
  }
}
