import type { ApiClient } from './api-client.js';
import {
  ApiAgentList,
  ApiConventionsState,
  ApiReviewList,
  ApiReviewStarted,
  ApiRunList,
  type ApiAgent,
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
}
