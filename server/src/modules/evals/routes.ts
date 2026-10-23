import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AgentEvalCase,
  AgentEvalRun,
  AgentEvalRunDetail,
  CreateEvalCaseFromFinding,
  EvalRunComparison,
  StartEvalRunInput,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EVAL_RUNS_MAX_LIMIT, EVAL_WRITE_RATE_LIMIT } from './constants.js';
import { EvalService } from './service.js';

const RunsQuery = z.object({ limit: z.coerce.number().int().min(1).max(EVAL_RUNS_MAX_LIMIT).optional() });
const CompareQuery = z.object({ base: z.string().uuid(), head: z.string().uuid() });

/**
 * Agent eval pipeline (L06).
 *   POST /findings/:id/eval-case      → freeze a decided finding into an eval case (201)
 *   GET /agents/:id/eval-cases        → labeled eval cases of the agent, newest first
 *   POST /agents/:id/eval-runs        → start an eval run of the agent's current config (202)
 *   GET /agents/:id/eval-runs?limit=  → eval run history of the agent, newest first
 *   GET /eval-runs/:id                → one run: metrics, counts, per-case results, errors
 *   GET /eval-runs/compare?base=&head= → two done runs of one agent: deltas, config + case changes
 * Only POST /agents/:id/eval-runs calls the LLM (in the background).
 */
export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalService(container);

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(AgentEvalCase) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listCases(workspaceId, req.params.id);
    },
  );

  // Freezes the PR diff into a new case; rate-limited like other write paths.
  // Body is optional (an empty POST uses the default name), so it is parsed here.
  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams }, config: { rateLimit: EVAL_WRITE_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const body = CreateEvalCaseFromFinding.parse(req.body ?? {});
      const created = await service.createFromFinding(workspaceId, req.params.id, body);
      return reply.status(201).send(created);
    },
  );

  // Starts a PAID run (one engine call per distinct frozen input): rate-limited,
  // one running run per agent. 202 + the `running` row; poll the history for the result.
  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: EVAL_WRITE_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const body = StartEvalRunInput.parse(req.body ?? {});
      const run = await service.startRun(workspaceId, req.params.id, body);
      return reply.status(202).send(run);
    },
  );

  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, querystring: RunsQuery, response: { 200: z.array(AgentEvalRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listRuns(workspaceId, req.params.id, req.query.limit);
    },
  );

  // Static path: registered with /eval-runs/:id, find-my-way prefers it over the param route.
  app.get(
    '/eval-runs/compare',
    { schema: { querystring: CompareQuery, response: { 200: EvalRunComparison } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.compare(workspaceId, req.query.base, req.query.head);
    },
  );

  app.get(
    '/eval-runs/:id',
    { schema: { params: IdParams, response: { 200: AgentEvalRunDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getRun(workspaceId, req.params.id);
    },
  );
}
