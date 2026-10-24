import { describe, it, expect } from 'vitest';
import type { CommitIfUnchangedPayload, RepoRef } from '@devdigest/shared';
import { OctokitGitHubClient, GitHubAdapterError, assertCommitPaths } from '../src/adapters/github/octokit.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';

/**
 * L07 B3 — GitHubClient methods for Export to CI (specs/export-to-ci.md §6.1,
 * §8, AC-CI-77, 80, 89–91). The Octokit implementation runs against an
 * injected fake `fetch` (no network, Octokit's own retries off); the mock is
 * checked for the behaviour later tasks rely on (call log, CAS, failures).
 */

const REPO: RepoRef = { owner: 'acme', name: 'widgets' };
const TOKEN = 'ghp_SECRET_TOKEN_VALUE';
const SIGNED_URL = 'https://pipelines.blob.example.net/artifact.zip?sig=SIGNED_SECRET&se=2026';

interface SeenRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown> | undefined;
  headers: Record<string, string>;
  redirect: string | undefined;
}
type Route = [method: string, path: RegExp, reply: (req: SeenRequest) => Response | Promise<Response>];

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const ghError = (status: number, message: string) => json({ message }, status);

function fakeGitHub(routes: Route[]) {
  const requests: SeenRequest[] = [];
  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const raw = init.body;
    const req: SeenRequest = {
      method: (init.method ?? 'GET').toUpperCase(),
      path: decodeURIComponent(url.pathname),
      query: url.searchParams,
      body: typeof raw === 'string' && raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      redirect: init.redirect,
    };
    requests.push(req);
    const route = routes.find(([m, p]) => m === req.method && p.test(`${url.host}${req.path}`));
    return route ? route[2](req) : ghError(404, `unrouted ${req.method} ${url.host}${req.path}`);
  };
  const client = new OctokitGitHubClient(TOKEN, { fetch: fetchImpl as typeof fetch, retries: 0, throttle: false });
  const writes = () => requests.filter((r) => r.method !== 'GET');
  return { client, requests, writes };
}

const API = 'api\\.github\\.com/repos/acme/widgets';
const re = (s: string) => new RegExp(`^${s}$`);

/** Every string an error could leak through (message + Octokit request metadata). */
const leakSurface = (err: unknown) =>
  JSON.stringify({
    message: (err as Error).message,
    request: (err as { request?: unknown }).request,
    response: (err as { response?: { url?: string } }).response?.url,
  });

describe('OctokitGitHubClient — reads at fixed SHAs', () => {
  it('getDefaultBranch returns the repository default branch (AC-CI-80)', async () => {
    const { client } = fakeGitHub([['GET', re(API), () => json({ default_branch: 'develop' })]]);
    expect(await client.getDefaultBranch(REPO)).toBe('develop');
  });

  it('getBranchHeadSha returns the head SHA, or null when the branch is missing', async () => {
    const { client, requests } = fakeGitHub([
      ['GET', re(`${API}/git/ref/heads/devdigest/ci`), () => json({ ref: 'refs/heads/devdigest/ci', object: { sha: 'h0', type: 'commit' } })],
      ['GET', re(`${API}/git/ref/heads/main`), () => ghError(404, 'Not Found')],
    ]);
    expect(await client.getBranchHeadSha(REPO, 'devdigest/ci')).toBe('h0');
    expect(await client.getBranchHeadSha(REPO, 'main')).toBeNull();
    expect(requests.map((r) => r.path)).toEqual([
      '/repos/acme/widgets/git/ref/heads/devdigest/ci',
      '/repos/acme/widgets/git/ref/heads/main',
    ]);
  });

  it('an auth failure propagates with its status and never carries the token', async () => {
    const { client } = fakeGitHub([['GET', re(`${API}/git/ref/heads/main`), () => ghError(401, 'Bad credentials')]]);
    const err = await client.getBranchHeadSha(REPO, 'main').catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(401);
    expect(leakSurface(err)).not.toContain(TOKEN);
  });

  it('listDirectory reads at the given SHA, maps entries, and returns [] for a missing directory', async () => {
    const { client, requests } = fakeGitHub([
      [
        'GET',
        re(`${API}/contents/\\.devdigest/agents`),
        (req) =>
          req.query.get('ref') === 'b0'
            ? json([
                { name: 'security.yaml', path: '.devdigest/agents/security.yaml', type: 'file' },
                { name: 'old', path: '.devdigest/agents/old', type: 'dir' },
              ])
            : ghError(404, 'Not Found'),
      ],
    ]);
    expect(await client.listDirectory(REPO, '.devdigest/agents', 'b0')).toEqual([
      { name: 'security.yaml', path: '.devdigest/agents/security.yaml', type: 'file' },
      { name: 'old', path: '.devdigest/agents/old', type: 'dir' },
    ]);
    expect(await client.listDirectory(REPO, '.devdigest/agents', 'h0')).toEqual([]);
    expect(requests.map((r) => r.query.get('ref'))).toEqual(['b0', 'h0']);
  });

  it('listDirectory rejects a path that is a file', async () => {
    const { client } = fakeGitHub([
      ['GET', re(`${API}/contents/\\.devdigest/agents`), () => json({ type: 'file', name: 'agents', path: '.devdigest/agents', sha: 's', size: 1 })],
    ]);
    await expect(client.listDirectory(REPO, '.devdigest/agents', 'b0')).rejects.toMatchObject({ status: 422 });
  });

  it('readFile decodes base64 at the given SHA, returns null when missing, and reads large files via the blob', async () => {
    const yaml = '{ "name": "Security", "agent_id": "a1" }';
    const big = 'x'.repeat(16);
    const { client, requests } = fakeGitHub([
      [
        'GET',
        re(`${API}/contents/\\.devdigest/agents/security\\.yaml`),
        (req) =>
          req.query.get('ref') === 'b0'
            ? json({ type: 'file', encoding: 'base64', size: yaml.length, sha: 's1', content: Buffer.from(yaml).toString('base64') })
            : ghError(404, 'Not Found'),
      ],
      ['GET', re(`${API}/contents/\\.devdigest/runner/index\\.js`), () => json({ type: 'file', encoding: 'none', size: 2_000_000, sha: 'blob1', content: '' })],
      ['GET', re(`${API}/git/blobs/blob1`), () => json({ content: Buffer.from(big).toString('base64'), encoding: 'base64' })],
    ]);
    expect(await client.readFile(REPO, '.devdigest/agents/security.yaml', 'b0')).toBe(yaml);
    expect(await client.readFile(REPO, '.devdigest/agents/security.yaml', 'h0')).toBeNull();
    expect(await client.readFile(REPO, '.devdigest/runner/index.js', 'b0')).toBe(big);
    expect(requests.filter((r) => r.path.includes('/contents/')).map((r) => r.query.get('ref'))).toEqual(['b0', 'h0', 'b0']);
  });

  it('readFile rejects a directory', async () => {
    const { client } = fakeGitHub([['GET', re(`${API}/contents/\\.devdigest`), () => json([])]]);
    await expect(client.readFile(REPO, '.devdigest', 'b0')).rejects.toMatchObject({ status: 422 });
  });
});

describe('OctokitGitHubClient.commitFilesIfUnchanged — compare-and-swap, never force (AC-CI-91)', () => {
  const files = [
    { path: '.devdigest/agents/security.yaml', contents: '{}' },
    { path: '.github/workflows/devdigest-review.yml', contents: 'name: x' },
  ];
  const payload = (over: Partial<CommitIfUnchangedPayload> = {}): CommitIfUnchangedPayload => ({
    branch: 'devdigest/ci',
    expectedHeadSha: 'h0',
    baseSha: 'b0',
    message: 'chore(devdigest): add DevDigest CI review',
    files,
    ...over,
  });

  /** Git-data routes shared by the scenarios; `head` / `refWrite` vary. */
  function gitRoutes(head: () => Response, refWrite: (req: SeenRequest) => Response): Route[] {
    let blob = 0;
    return [
      ['GET', re(`${API}/git/ref/heads/devdigest/ci`), head],
      ['GET', re(`${API}/git/commits/(h0|b0)`), () => json({ sha: 'p', tree: { sha: 'parent-tree' } })],
      ['POST', re(`${API}/git/blobs`), () => json({ sha: `blob-${++blob}` }, 201)],
      ['POST', re(`${API}/git/trees`), () => json({ sha: 'new-tree' }, 201)],
      ['POST', re(`${API}/git/commits`), () => json({ sha: 'new-commit' }, 201)],
      ['PATCH', re(`${API}/git/refs/heads/devdigest/ci`), refWrite],
      ['POST', re(`${API}/git/refs`), refWrite],
    ];
  }
  const headAt = (sha: string) => () => json({ object: { sha, type: 'commit' } });

  it('updates an existing branch with one commit on the inspected head, without force', async () => {
    const { client, writes } = fakeGitHub(gitRoutes(headAt('h0'), () => json({ object: { sha: 'new-commit' } })));
    expect(await client.commitFilesIfUnchanged(REPO, payload())).toEqual({ ok: true, commitSha: 'new-commit' });

    const w = writes();
    expect(w.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /repos/acme/widgets/git/blobs',
      'POST /repos/acme/widgets/git/blobs',
      'POST /repos/acme/widgets/git/trees',
      'POST /repos/acme/widgets/git/commits',
      'PATCH /repos/acme/widgets/git/refs/heads/devdigest/ci',
    ]);
    // Only the given paths, layered on the parent tree (nothing deleted).
    expect(w[2]!.body).toEqual({
      base_tree: 'parent-tree',
      tree: [
        { path: '.devdigest/agents/security.yaml', mode: '100644', type: 'blob', sha: 'blob-1' },
        { path: '.github/workflows/devdigest-review.yml', mode: '100644', type: 'blob', sha: 'blob-2' },
      ],
    });
    expect(w[3]!.body).toMatchObject({ parents: ['h0'], tree: 'new-tree' });
    expect(w[4]!.body).toEqual({ sha: 'new-commit', force: false });
  });

  it('creates a missing branch at a commit on the inspected base SHA', async () => {
    const { client, writes } = fakeGitHub(gitRoutes(() => ghError(404, 'Not Found'), () => json({ ref: 'refs/heads/devdigest/ci' }, 201)));
    const res = await client.commitFilesIfUnchanged(REPO, payload({ expectedHeadSha: null }));
    expect(res).toEqual({ ok: true, commitSha: 'new-commit' });
    const w = writes();
    expect(w.find((r) => r.path.endsWith('/git/commits'))!.body).toMatchObject({ parents: ['b0'] });
    expect(w.at(-1)).toMatchObject({ method: 'POST', path: '/repos/acme/widgets/git/refs', body: { ref: 'refs/heads/devdigest/ci', sha: 'new-commit' } });
  });

  it('a branch that moved before the commit → ref_changed with no write at all', async () => {
    const { client, writes } = fakeGitHub(gitRoutes(headAt('h1'), () => json({})));
    expect(await client.commitFilesIfUnchanged(REPO, payload())).toEqual({ ok: false, reason: 'ref_changed' });
    expect(writes()).toEqual([]);
  });

  it('a branch created by someone else before the commit → ref_changed with no write', async () => {
    const { client, writes } = fakeGitHub(gitRoutes(headAt('x9'), () => json({})));
    expect(await client.commitFilesIfUnchanged(REPO, payload({ expectedHeadSha: null }))).toEqual({ ok: false, reason: 'ref_changed' });
    expect(writes()).toEqual([]);
  });

  it('a branch that moves between the check and the ref update (non fast-forward 422) → ref_changed', async () => {
    const { client, writes } = fakeGitHub(gitRoutes(headAt('h0'), () => ghError(422, 'Update is not a fast forward')));
    expect(await client.commitFilesIfUnchanged(REPO, payload())).toEqual({ ok: false, reason: 'ref_changed' });
    expect(writes().at(-1)!.body).toEqual({ sha: 'new-commit', force: false });
  });

  it('a branch created concurrently (422 Reference already exists) → ref_changed', async () => {
    const { client } = fakeGitHub(gitRoutes(() => ghError(404, 'Not Found'), () => ghError(422, 'Reference already exists')));
    expect(await client.commitFilesIfUnchanged(REPO, payload({ expectedHeadSha: null }))).toEqual({ ok: false, reason: 'ref_changed' });
  });

  it('an unknown ref-write outcome is resolved by re-reading the ref', async () => {
    let refReads = 0;
    const head = () => json({ object: { sha: ++refReads === 1 ? 'h0' : 'new-commit', type: 'commit' } });
    const { client } = fakeGitHub(gitRoutes(head, () => ghError(502, 'Bad Gateway')));
    expect(await client.commitFilesIfUnchanged(REPO, payload())).toEqual({ ok: true, commitSha: 'new-commit' });
  });

  it('an unknown ref-write outcome that did not land is rethrown with its status', async () => {
    const { client } = fakeGitHub(gitRoutes(headAt('h0'), () => ghError(502, 'Bad Gateway')));
    await expect(client.commitFilesIfUnchanged(REPO, payload())).rejects.toMatchObject({ status: 502 });
  });

  it('rejects unsafe or duplicate paths before any request', async () => {
    const { client, requests } = fakeGitHub([]);
    for (const path of ['/etc/passwd', '../x', 'a/../b', 'a//b', './a', 'a\\b', '']) {
      await expect(client.commitFilesIfUnchanged(REPO, payload({ files: [{ path, contents: '' }] }))).rejects.toMatchObject({ status: 422 });
    }
    await expect(
      client.commitFilesIfUnchanged(REPO, payload({ files: [{ path: 'a', contents: '1' }, { path: 'a', contents: '2' }] })),
    ).rejects.toThrow(/Duplicate commit path/);
    expect(requests).toEqual([]);
  });
});

describe('OctokitGitHubClient — workflow runs and artifacts', () => {
  it('listWorkflowRuns asks for completed runs of the workflow file and maps the fields', async () => {
    const { client, requests } = fakeGitHub([
      [
        'GET',
        re(`${API}/actions/workflows/devdigest-review\\.yml/runs`),
        () =>
          json({
            total_count: 1,
            workflow_runs: [
              {
                id: 123456789012,
                head_sha: 'abc123',
                repository: { id: 42, full_name: 'acme/widgets' },
                head_repository: { full_name: 'acme/widgets' },
                path: '.github/workflows/devdigest-review.yml',
                event: 'pull_request',
                status: 'completed',
                conclusion: 'failure',
                html_url: 'https://github.com/acme/widgets/actions/runs/123456789012',
                pull_requests: [{ number: 7 }],
                run_started_at: '2026-10-23T10:00:00Z',
                updated_at: '2026-10-23T10:02:00Z',
              },
            ],
          }),
      ],
    ]);
    expect(await client.listWorkflowRuns(REPO, 'devdigest-review.yml', { perPage: 20 })).toEqual([
      {
        id: 123456789012,
        head_sha: 'abc123',
        repository_id: 42,
        repository_full_name: 'acme/widgets',
        head_repository_full_name: 'acme/widgets',
        path: '.github/workflows/devdigest-review.yml',
        event: 'pull_request',
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/acme/widgets/actions/runs/123456789012',
        pull_request_numbers: [7],
        run_started_at: '2026-10-23T10:00:00Z',
        updated_at: '2026-10-23T10:02:00Z',
      },
    ]);
    expect(requests[0]!.query.get('status')).toBe('completed');
    expect(requests[0]!.query.get('per_page')).toBe('20');
  });

  it('a missing workflow (404) propagates for the caller to decide', async () => {
    const { client } = fakeGitHub([['GET', re(`${API}/actions/workflows/devdigest-review\\.yml/runs`), () => ghError(404, 'Not Found')]]);
    await expect(client.listWorkflowRuns(REPO, 'devdigest-review.yml', { perPage: 20 })).rejects.toMatchObject({ status: 404 });
  });

  it('listRunArtifacts maps id, name, size and expiry', async () => {
    const { client } = fakeGitHub([
      [
        'GET',
        re(`${API}/actions/runs/99/artifacts`),
        () => json({ total_count: 1, artifacts: [{ id: 5, name: 'devdigest-result', size_in_bytes: 321, expired: false, url: 'u' }] }),
      ],
    ]);
    expect(await client.listRunArtifacts(REPO, 99)).toEqual([{ id: 5, name: 'devdigest-result', size_in_bytes: 321, expired: false }]);
  });

  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  const redirectRoute = (): Route => [
    'GET',
    re(`${API}/actions/artifacts/5/zip`),
    () => new Response(null, { status: 302, headers: { location: SIGNED_URL } }),
  ];

  it('downloadArtifact does not follow the redirect with the token: the signed URL is fetched without Authorization', async () => {
    const { client, requests } = fakeGitHub([
      redirectRoute(),
      ['GET', /^pipelines\.blob\.example\.net\/artifact\.zip$/, () => new Response(zip, { status: 200 })],
    ]);
    expect(await client.downloadArtifact(REPO, 5, { maxBytes: 1024 })).toEqual(zip);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.redirect).toBe('manual');
    expect(requests[0]!.headers.authorization).toContain(TOKEN.slice(0, 4));
    expect(requests[1]!.headers.authorization).toBeUndefined();
  });

  it('downloadArtifact refuses an artifact over maxBytes (declared or streamed) without echoing the signed URL', async () => {
    for (const reply of [
      () => new Response(zip, { status: 200, headers: { 'content-length': '999999' } }),
      () => new Response(zip, { status: 200 }),
    ]) {
      const { client } = fakeGitHub([redirectRoute(), ['GET', /^pipelines\.blob\.example\.net\/artifact\.zip$/, reply]]);
      const err = await client.downloadArtifact(REPO, 5, { maxBytes: 4 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GitHubAdapterError);
      expect((err as GitHubAdapterError).status).toBe(413);
      expect(leakSurface(err)).not.toContain('SIGNED_SECRET');
    }
  });

  it('a storage error keeps its status and never echoes the signed URL or the token', async () => {
    const { client } = fakeGitHub([
      redirectRoute(),
      ['GET', /^pipelines\.blob\.example\.net\/artifact\.zip$/, () => new Response('AuthenticationFailed', { status: 403 })],
    ]);
    const err = await client.downloadArtifact(REPO, 5, { maxBytes: 1024 }).catch((e: unknown) => e);
    expect((err as GitHubAdapterError).status).toBe(403);
    expect(leakSurface(err)).not.toContain('SIGNED_SECRET');
    expect(leakSurface(err)).not.toContain(TOKEN);
  });

  it('an expired artifact (410 from GitHub) propagates with its status', async () => {
    const { client } = fakeGitHub([['GET', re(`${API}/actions/artifacts/5/zip`), () => ghError(410, 'Artifact has expired')]]);
    const err = await client.downloadArtifact(REPO, 5, { maxBytes: 1024 }).catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(410);
    expect(leakSurface(err)).not.toContain(TOKEN);
  });
});

describe('OctokitGitHubClient.findOpenPr', () => {
  it('returns the open PR from the branch with its base branch, or null', async () => {
    const { client, requests } = fakeGitHub([
      ['GET', re(`${API}/pulls`), (req) =>
        req.query.get('head') === 'acme:devdigest/ci'
          ? json([{ html_url: 'https://github.com/acme/widgets/pull/9', base: { ref: 'develop' } }])
          : json([])],
    ]);
    expect(await client.findOpenPr(REPO, 'devdigest/ci')).toEqual({ url: 'https://github.com/acme/widgets/pull/9', base: 'develop' });
    expect(await client.findOpenPr(REPO, 'other')).toBeNull();
    expect(requests[0]!.query.get('state')).toBe('open');
  });
});

describe('assertCommitPaths', () => {
  it('accepts plain repo-relative paths', () => {
    expect(() => assertCommitPaths([{ path: '.devdigest/skills/a.md', contents: '' }, { path: 'a', contents: '' }])).not.toThrow();
  });
});

describe('MockGitHubClient — Export to CI', () => {
  const trees = {
    b0: { 'README.md': '# hi', '.devdigest/agents/security.yaml': '{"agent_id":"a1"}', '.devdigest/skills/owasp.md': 'x' },
  };

  it('findOpenPr returns an opened PR of the branch with its base', async () => {
    const gh = new MockGitHubClient();
    expect(await gh.findOpenPr(REPO, 'devdigest/ci')).toBeNull();
    await gh.openPullRequest(REPO, { title: 't', head: 'devdigest/ci', base: 'develop', body: 'b' });
    expect(await gh.findOpenPr(REPO, 'devdigest/ci')).toEqual({ url: 'https://github.com/mock/mock/pull/1', base: 'develop' });
  });

  it('logs every call, including the existing methods, in order', async () => {
    const gh = new MockGitHubClient({ trees, branches: { main: 'b0' } });
    await gh.getDefaultBranch(REPO);
    await gh.getBranchHeadSha(REPO, 'main');
    await gh.findOpenPr(REPO, 'devdigest/ci');
    expect(gh.calls.map((c) => c.method)).toEqual(['getDefaultBranch', 'getBranchHeadSha', 'findOpenPr']);
  });

  it('serves branches, directories and files of an in-memory repo', async () => {
    const gh = new MockGitHubClient({ trees, branches: { main: 'b0' }, defaultBranch: 'main' });
    expect(await gh.getDefaultBranch(REPO)).toBe('main');
    expect(await gh.getBranchHeadSha(REPO, 'main')).toBe('b0');
    expect(await gh.getBranchHeadSha(REPO, 'devdigest/ci')).toBeNull();
    expect(await gh.listDirectory(REPO, '.devdigest', 'b0')).toEqual([
      { name: 'agents', path: '.devdigest/agents', type: 'dir' },
      { name: 'skills', path: '.devdigest/skills', type: 'dir' },
    ]);
    expect(await gh.listDirectory(REPO, '.devdigest/agents/', 'b0')).toEqual([
      { name: 'security.yaml', path: '.devdigest/agents/security.yaml', type: 'file' },
    ]);
    expect(await gh.listDirectory(REPO, '.github/workflows', 'b0')).toEqual([]);
    expect(await gh.readFile(REPO, '.devdigest/agents/security.yaml', 'b0')).toBe('{"agent_id":"a1"}');
    expect(await gh.readFile(REPO, 'missing.txt', 'b0')).toBeNull();
    await expect(gh.readFile(REPO, '.devdigest', 'b0')).rejects.toMatchObject({ status: 422 });
    await expect(gh.listDirectory(REPO, 'README.md', 'b0')).rejects.toMatchObject({ status: 422 });
  });

  it('a CAS commit layers the files on the parent tree and moves the branch', async () => {
    const gh = new MockGitHubClient({ trees, branches: { main: 'b0' } });
    const res = await gh.commitFilesIfUnchanged(REPO, {
      branch: 'devdigest/ci',
      expectedHeadSha: null,
      baseSha: 'b0',
      message: 'm',
      files: [{ path: '.github/workflows/devdigest-review.yml', contents: 'name: x' }],
    });
    expect(res).toEqual({ ok: true, commitSha: 'mock-commit-1' });
    expect(gh.branches['devdigest/ci']).toBe('mock-commit-1');
    expect(gh.trees['mock-commit-1']).toEqual({ ...trees.b0, '.github/workflows/devdigest-review.yml': 'name: x' });
    expect(gh.trees.b0).toEqual(trees.b0); // parent snapshot untouched
    expect(gh.casCommits).toHaveLength(1);
  });

  it('a concurrent push simulated in beforeRefWrite → ref_changed and nothing written', async () => {
    const gh = new MockGitHubClient({
      trees,
      branches: { main: 'b0', 'devdigest/ci': 'h0' },
      beforeRefWrite: (m) => m.moveBranch('devdigest/ci', 'someone-else'),
    });
    const res = await gh.commitFilesIfUnchanged(REPO, {
      branch: 'devdigest/ci',
      expectedHeadSha: 'h0',
      baseSha: 'b0',
      message: 'm',
      files: [{ path: 'a.txt', contents: '1' }],
    });
    expect(res).toEqual({ ok: false, reason: 'ref_changed' });
    expect(gh.branches['devdigest/ci']).toBe('someone-else');
    expect(gh.casCommits).toEqual([]);
  });

  it('a branch deleted after inspection → ref_changed', async () => {
    const gh = new MockGitHubClient({ branches: { 'devdigest/ci': 'h0' }, beforeRefWrite: (m) => m.moveBranch('devdigest/ci', null) });
    const res = await gh.commitFilesIfUnchanged(REPO, { branch: 'devdigest/ci', expectedHeadSha: 'h0', baseSha: 'b0', message: 'm', files: [] });
    expect(res).toEqual({ ok: false, reason: 'ref_changed' });
  });

  it('failWith makes a method reject with that status (auth, 404, rate limit, 5xx), still logged', async () => {
    const gh = new MockGitHubClient({ failWith: { listWorkflowRuns: 401, listRunArtifacts: 429, getDefaultBranch: 404, downloadArtifact: 503 } });
    await expect(gh.listWorkflowRuns(REPO, 'devdigest-review.yml', { perPage: 20 })).rejects.toMatchObject({ status: 401 });
    await expect(gh.listRunArtifacts(REPO, 1)).rejects.toMatchObject({ status: 429 });
    await expect(gh.getDefaultBranch(REPO)).rejects.toMatchObject({ status: 404 });
    await expect(gh.downloadArtifact(REPO, 1, { maxBytes: 10 })).rejects.toMatchObject({ status: 503 });
    expect(gh.calls).toHaveLength(4);
  });

  it('runs, artifacts and downloads come from the options; downloads honour maxBytes', async () => {
    const run = {
      id: 1,
      head_sha: 's',
      repository_id: 42,
      repository_full_name: 'acme/widgets',
      head_repository_full_name: 'acme/widgets',
      path: '.github/workflows/devdigest-review.yml',
      event: 'pull_request',
      status: 'completed',
      conclusion: 'success',
      html_url: 'u',
      pull_request_numbers: [7],
      run_started_at: null,
      updated_at: 't',
    };
    const gh = new MockGitHubClient({
      workflowRuns: [run, { ...run, id: 2 }, { ...run, id: 3 }],
      runArtifacts: { 1: [{ id: 5, name: 'devdigest-result', size_in_bytes: 3, expired: false }] },
      artifactZips: { 5: new Uint8Array([1, 2, 3]) },
    });
    expect((await gh.listWorkflowRuns(REPO, 'devdigest-review.yml', { perPage: 2 })).map((r) => r.id)).toEqual([1, 2]);
    expect(await gh.listRunArtifacts(REPO, 1)).toHaveLength(1);
    expect(await gh.listRunArtifacts(REPO, 2)).toEqual([]);
    expect(await gh.downloadArtifact(REPO, 5, { maxBytes: 3 })).toEqual(new Uint8Array([1, 2, 3]));
    await expect(gh.downloadArtifact(REPO, 5, { maxBytes: 2 })).rejects.toMatchObject({ status: 413 });
    await expect(gh.downloadArtifact(REPO, 6, { maxBytes: 10 })).rejects.toMatchObject({ status: 404 });
  });
});
