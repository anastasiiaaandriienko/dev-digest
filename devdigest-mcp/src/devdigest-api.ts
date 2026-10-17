import type { ApiClient } from './api-client.js';
import {
  ApiAgentList,
  ApiBlastRadius,
  ApiPullLookup,
  ApiConventionsState,
  ApiReviewList,
  ApiReviewStarted,
  ApiRunList,
  type ApiAgent,
  type ApiBlastRadius as BlastRadius,
  type ApiPullLookup as PullLookup,
  type ApiConventionsState as ConventionsState,
  type ApiReview,
  type ApiReviewStarted as ReviewStarted,
  type ApiRunSummary,
} from './api-schemas.js';

/**
 * The DevDigest endpoints this MCP server uses — the only module that knows
 * Fastify paths and response schemas. Tool handlers call these methods and
 * never build URLs themselves.
 */
export class DevDigestApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /agents — all agents of the workspace (enabled or not). */
  listAgents(): Promise<ApiAgent[]> {
    return this.client.get('/agents', ApiAgentList);
  }

  /** POST /pulls/:id/review {agentId} — starts ONE review run (paid LLM call, fire-and-forget). */
  startReview(prId: string, agentId: string): Promise<ReviewStarted> {
    return this.client.post(`/pulls/${prId}/review`, { agentId }, ApiReviewStarted);
  }

  /** GET /pulls/:id/runs — all runs of the PR, newest first. */
  listRuns(prId: string): Promise<ApiRunSummary[]> {
    return this.client.get(`/pulls/${prId}/runs`, ApiRunList);
  }

  /** GET /pulls/:id/reviews — persisted reviews with their findings, newest first. */
  listReviews(prId: string): Promise<ApiReview[]> {
    return this.client.get(`/pulls/${prId}/reviews`, ApiReviewList);
  }

  /** GET /repos/:id/conventions — latest scan + candidates (rejected only on request). */
  getConventions(repoId: string, includeRejected: boolean): Promise<ConventionsState> {
    return this.client.get(`/repos/${repoId}/conventions?include_rejected=${includeRejected}`, ApiConventionsState);
  }

  /** GET /pulls?number=&title=&repo= — read-only lookup of stored PRs (every match; the caller decides). */
  findPulls(query: { number?: number; title?: string; repo?: string }): Promise<PullLookup> {
    const params = new URLSearchParams();
    if (query.number !== undefined) params.set('number', String(query.number));
    if (query.title !== undefined) params.set('title', query.title);
    if (query.repo !== undefined) params.set('repo', query.repo);
    return this.client.get(`/pulls?${params.toString()}`, ApiPullLookup);
  }

  /** GET /pulls/:id/blast — read-only blast radius from stored pr_files + the repo-intel index. */
  getBlastRadius(prId: string): Promise<BlastRadius> {
    return this.client.get(`/pulls/${prId}/blast`, ApiBlastRadius);
  }
}
