import { Octokit } from 'octokit';
import type {
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
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
} from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';

import { assertCommitPaths, GitHubAdapterError } from './errors.js';

export { assertCommitPaths, GitHubAdapterError };

const TIMEOUT = 30_000;

const statusOf = (err: unknown): number | undefined => (err as { status?: number } | null)?.status;

/** Read a response body, refusing more than `max` bytes (zip-bomb / oversize guard). */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const tooLarge = () => new GitHubAdapterError(`Artifact larger than ${max} bytes`, 413);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > max) throw tooLarge();
    return bytes;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Test seams only: an injected `fetch`, the Octokit retry count, request throttling. */
export interface OctokitClientOptions {
  fetch?: typeof fetch;
  retries?: number;
  /** false disables Octokit's request throttling (it spaces writes ~1 s apart). */
  throttle?: boolean;
}

function mapStatus(state: string, merged: boolean | undefined): PrStatus {
  if (merged) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

/**
 * GitHubClient over Octokit REST — thin. PAT auth (fine-grained).
 * Reads PR list/detail/files/commits/issue; posts reviews; opens PRs.
 */
export class OctokitGitHubClient implements GitHubClient {
  private octokit: Octokit;
  private fetchImpl: typeof fetch;

  constructor(token: string, opts: OctokitClientOptions = {}) {
    const request = {
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.retries != null ? { retries: opts.retries } : {}),
    };
    this.octokit = new Octokit({
      auth: token,
      ...(Object.keys(request).length ? { request } : {}),
      ...(opts.throttle === false ? { throttle: { enabled: false } } : {}),
    });
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          // Fetch open + recently merged/closed (most-recently-updated first) so
          // the list shows which PRs are merged vs still open — not just open.
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'all',
            sort: 'updated',
            direction: 'desc',
            per_page: 50,
          });
          return res.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: 0,
            deletions: 0,
            files_count: 0, // not present on the list payload; populated by getPullRequest
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data: pr } = await this.octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
          });
          const { data: files } = await this.octokit.rest.pulls.listFiles({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const { data: commits } = await this.octokit.rest.pulls.listCommits({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const linkedIssue = await this.resolveLinkedIssue(repo, pr.body ?? '');
          return {
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: pr.additions,
            deletions: pr.deletions,
            files_count: pr.changed_files,
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
            body: pr.body,
            files: files.map((f) => ({
              path: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            })),
            commits: commits.map((c) => ({
              sha: c.sha,
              message: c.commit.message,
              author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
              committed_at: c.commit.author?.date,
            })),
            linked_issue: linkedIssue,
          };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** linked issue via regex on PR body (#123 / closes #123). */
  private async resolveLinkedIssue(repo: RepoRef, body: string): Promise<IssueMeta | undefined> {
    const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
    if (!m?.[1]) return undefined;
    try {
      return await this.getIssue(repo, Number(m[1]));
    } catch {
      return undefined;
    }
  }

  async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.createReview({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            body: review.body,
            event: review.event,
            comments: review.comments?.map((c) => ({
              path: c.path,
              line: c.line,
              body: c.body,
            })),
          });
          return { id: String(res.data.id) };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** Shape an Octokit review-comment payload into our DTO. */
  private mapReviewComment(c: {
    id: number;
    path: string;
    line?: number | null;
    original_line?: number | null;
    side?: string | null;
    body: string;
    user: { login: string } | null;
    created_at: string;
    html_url: string;
    in_reply_to_id?: number;
  }): PrReviewComment {
    return {
      id: c.id,
      path: c.path,
      line: c.line ?? null,
      original_line: c.original_line ?? null,
      side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      body: c.body,
      user: c.user?.login ?? 'unknown',
      created_at: c.created_at,
      html_url: c.html_url,
      in_reply_to_id: c.in_reply_to_id ?? null,
      // GitHub drops `line` when the comment can no longer be placed on the diff.
      is_outdated: c.line == null,
    };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          return res.data.map((c) => this.mapReviewComment(c));
        })(),
        TIMEOUT,
      ),
    );
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          if (input.inReplyTo != null) {
            const res = await this.octokit.rest.pulls.createReplyForReviewComment({
              owner: repo.owner,
              repo: repo.name,
              pull_number: n,
              comment_id: input.inReplyTo,
              body: input.body,
            });
            return this.mapReviewComment(res.data);
          }
          const res = await this.octokit.rest.pulls.createReviewComment({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            commit_id: input.commitId,
            path: input.path,
            line: input.line,
            side: input.side ?? 'RIGHT',
            body: input.body,
          });
          return this.mapReviewComment(res.data);
        })(),
        TIMEOUT,
      ),
    );
  }

  async openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.create({
            owner: repo.owner,
            repo: repo.name,
            title: payload.title,
            head: payload.head,
            base: payload.base,
            body: payload.body,
          });
          return { url: res.data.html_url };
        })(),
        TIMEOUT,
      ),
    );
  }

  async commitFiles(
    repo: RepoRef,
    payload: CommitFilesPayload,
  ): Promise<{ branch: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const owner = repo.owner;
          const name = repo.name;
          const g = this.octokit.rest.git;

          // Parent commit: the target branch if it already exists, else the base.
          let parentSha: string;
          let branchExists = false;
          try {
            const ref = await g.getRef({ owner, repo: name, ref: `heads/${payload.branch}` });
            parentSha = ref.data.object.sha;
            branchExists = true;
          } catch {
            const baseRef = await g.getRef({ owner, repo: name, ref: `heads/${payload.base}` });
            parentSha = baseRef.data.object.sha;
          }

          // New tree layered on the parent's tree (so unrelated files are kept).
          const parentCommit = await g.getCommit({ owner, repo: name, commit_sha: parentSha });
          const tree = await g.createTree({
            owner,
            repo: name,
            base_tree: parentCommit.data.tree.sha,
            tree: payload.files.map((f) => ({
              path: f.path,
              mode: '100644',
              type: 'blob',
              content: f.contents,
            })),
          });

          const commit = await g.createCommit({
            owner,
            repo: name,
            message: payload.message,
            tree: tree.data.sha,
            parents: [parentSha],
          });

          if (branchExists) {
            await g.updateRef({
              owner,
              repo: name,
              ref: `heads/${payload.branch}`,
              sha: commit.data.sha,
              force: true,
            });
          } else {
            await g.createRef({
              owner,
              repo: name,
              ref: `refs/heads/${payload.branch}`,
              sha: commit.data.sha,
            });
          }
          return { branch: payload.branch };
        })(),
        TIMEOUT,
      ),
    );
  }

  async findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string; base: string } | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'open',
            head: `${repo.owner}:${branch}`,
            per_page: 1,
          });
          const pr = res.data[0];
          return pr ? { url: pr.html_url, base: pr.base.ref } : null;
        })(),
        TIMEOUT,
      ),
    );
  }

  // ---- Export to CI (L07, specs/export-to-ci.md §6.1, §8) ------------------

  async getDefaultBranch(repo: RepoRef): Promise<string> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data } = await this.octokit.rest.repos.get({ owner: repo.owner, repo: repo.name });
          return data.default_branch;
        })(),
        TIMEOUT,
      ),
    );
  }

  async getBranchHeadSha(repo: RepoRef, branch: string): Promise<string | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          try {
            const { data } = await this.octokit.rest.git.getRef({
              owner: repo.owner,
              repo: repo.name,
              ref: `heads/${branch}`,
            });
            // An exact ref is an object; a list would mean only prefix matches exist.
            return Array.isArray(data) ? null : data.object.sha;
          } catch (err) {
            if (statusOf(err) === 404) return null;
            throw err;
          }
        })(),
        TIMEOUT,
      ),
    );
  }

  async listDirectory(repo: RepoRef, path: string, sha: string): Promise<RepoDirEntry[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          try {
            const { data } = await this.octokit.rest.repos.getContent({
              owner: repo.owner,
              repo: repo.name,
              path,
              ref: sha,
            });
            if (!Array.isArray(data)) throw new GitHubAdapterError(`Not a directory: ${path}`, 422);
            return data.map((e) => ({ name: e.name, path: e.path, type: e.type as RepoDirEntry['type'] }));
          } catch (err) {
            if (statusOf(err) === 404) return [];
            throw err;
          }
        })(),
        TIMEOUT,
      ),
    );
  }

  async readFile(repo: RepoRef, path: string, sha: string): Promise<string | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          let data: Awaited<ReturnType<Octokit['rest']['repos']['getContent']>>['data'];
          try {
            ({ data } = await this.octokit.rest.repos.getContent({
              owner: repo.owner,
              repo: repo.name,
              path,
              ref: sha,
            }));
          } catch (err) {
            if (statusOf(err) === 404) return null;
            throw err;
          }
          if (Array.isArray(data) || data.type !== 'file') {
            throw new GitHubAdapterError(`Not a file: ${path}`, 422);
          }
          if (data.size === 0) return '';
          if (data.encoding === 'base64' && data.content) {
            return Buffer.from(data.content, 'base64').toString('utf8');
          }
          // Files over 1 MB come back without inline content: read the blob.
          const blob = await this.octokit.rest.git.getBlob({
            owner: repo.owner,
            repo: repo.name,
            file_sha: data.sha,
          });
          return Buffer.from(blob.data.content, 'base64').toString('utf8');
        })(),
        TIMEOUT,
      ),
    );
  }

  async commitFilesIfUnchanged(
    repo: RepoRef,
    payload: CommitIfUnchangedPayload,
  ): Promise<CommitIfUnchangedResult> {
    assertCommitPaths(payload.files);
    const owner = repo.owner;
    const name = repo.name;
    const g = this.octokit.rest.git;
    const step = <T>(fn: () => Promise<T>) => withRetry(() => withTimeout(fn(), TIMEOUT));
    const changed: CommitIfUnchangedResult = { ok: false, reason: 'ref_changed' };

    // 1. Fail fast if the branch already moved since inspection.
    const current = await this.getBranchHeadSha(repo, payload.branch);
    if (current !== payload.expectedHeadSha) return changed;

    // 2. Git objects (blobs → tree on the parent's tree → commit). Creating
    //    them is idempotent and never touches a ref, so it may be retried.
    const parentSha = payload.expectedHeadSha ?? payload.baseSha;
    const parent = await step(() => g.getCommit({ owner, repo: name, commit_sha: parentSha }));
    const blobShas: string[] = [];
    for (const f of payload.files) {
      const blob = await step(() =>
        g.createBlob({ owner, repo: name, content: f.contents, encoding: 'utf-8' }),
      );
      blobShas.push(blob.data.sha);
    }
    const tree = await step(() =>
      g.createTree({
        owner,
        repo: name,
        base_tree: parent.data.tree.sha,
        tree: payload.files.map((f, i) => ({
          path: f.path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blobShas[i]!,
        })),
      }),
    );
    const commit = await step(() =>
      g.createCommit({
        owner,
        repo: name,
        message: payload.message,
        tree: tree.data.sha,
        parents: [parentSha],
      }),
    );
    const commitSha = commit.data.sha;

    // 3. Compare-and-swap on the ref: never force, never retried blindly.
    //    GitHub refuses a non-fast-forward update (the branch moved) and an
    //    existing ref on create — both mean someone else changed the branch.
    try {
      if (payload.expectedHeadSha) {
        await withTimeout(
          g.updateRef({ owner, repo: name, ref: `heads/${payload.branch}`, sha: commitSha, force: false }),
          TIMEOUT,
        );
      } else {
        await withTimeout(
          g.createRef({ owner, repo: name, ref: `refs/heads/${payload.branch}`, sha: commitSha }),
          TIMEOUT,
        );
      }
    } catch (err) {
      const status = statusOf(err);
      if (status === 422 || status === 404) return changed;
      // Unknown outcome (timeout, network, 5xx): the write may have landed.
      const now = await this.getBranchHeadSha(repo, payload.branch).catch(() => undefined);
      if (now === commitSha) return { ok: true, commitSha };
      throw err;
    }
    return { ok: true, commitSha };
  }

  async listWorkflowRuns(
    repo: RepoRef,
    workflowFile: string,
    opts: { perPage: number },
  ): Promise<WorkflowRunMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data } = await this.octokit.rest.actions.listWorkflowRuns({
            owner: repo.owner,
            repo: repo.name,
            workflow_id: workflowFile,
            status: 'completed',
            per_page: Math.min(Math.max(opts.perPage, 1), 100),
          });
          return data.workflow_runs.map((r) => ({
            id: r.id,
            head_sha: r.head_sha,
            repository_id: r.repository.id,
            repository_full_name: r.repository.full_name,
            head_repository_full_name: r.head_repository?.full_name ?? null,
            path: r.path,
            event: r.event,
            status: r.status ?? null,
            conclusion: r.conclusion ?? null,
            html_url: r.html_url,
            pull_request_numbers: (r.pull_requests ?? []).map((p) => p.number),
            run_started_at: r.run_started_at ?? null,
            updated_at: r.updated_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async listRunArtifacts(repo: RepoRef, runId: number): Promise<WorkflowRunArtifact[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data } = await this.octokit.rest.actions.listWorkflowRunArtifacts({
            owner: repo.owner,
            repo: repo.name,
            run_id: runId,
            per_page: 100,
          });
          return data.artifacts.map((a) => ({
            id: a.id,
            name: a.name,
            size_in_bytes: a.size_in_bytes,
            expired: a.expired,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  /**
   * GitHub answers with a 302 to a short-lived signed storage URL. The
   * redirect is NOT followed by Octokit (`redirect: 'manual'`): the signed URL
   * is fetched here without the Authorization header, so the token never
   * leaves api.github.com, and errors never echo the signed URL.
   */
  async downloadArtifact(
    repo: RepoRef,
    artifactId: number,
    opts: { maxBytes: number },
  ): Promise<Uint8Array> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.actions.downloadArtifact({
          owner: repo.owner,
          repo: repo.name,
          artifact_id: artifactId,
          archive_format: 'zip',
          request: { redirect: 'manual' },
        }),
        TIMEOUT,
      ),
    );
    const location = (res.headers as Record<string, string | undefined>).location;
    if (!location) throw new GitHubAdapterError('Artifact download returned no redirect location', 502);

    return withRetry(() =>
      withTimeout(
        (async () => {
          let blob: Response;
          try {
            blob = await this.fetchImpl(location, { redirect: 'follow' });
          } catch {
            throw new GitHubAdapterError('Artifact download failed: network error', 503);
          }
          if (!blob.ok) {
            throw new GitHubAdapterError(`Artifact download failed: HTTP ${blob.status}`, blob.status);
          }
          return readCapped(blob, opts.maxBytes);
        })(),
        TIMEOUT,
      ),
    );
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: n }),
        TIMEOUT,
      ),
    );
    return {
      number: res.data.number,
      title: res.data.title,
      body: res.data.body,
      state: res.data.state,
    };
  }

  async currentLogin(): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(this.octokit.rest.users.getAuthenticated(), TIMEOUT),
    );
    return res.data.login;
  }
}
