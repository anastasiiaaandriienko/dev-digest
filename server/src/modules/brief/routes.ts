import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { IntentRunRequest } from '@devdigest/shared';
import type { PrBriefState } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/**
 * PR Why + Risk Brief.
 *   GET  /pulls/:id/brief          → stored brief + freshness (local read, no LLM)
 *   POST /pulls/:id/brief {force?} → (re)generate when stale/missing (one model call)
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BriefService(container);

  app.get('/pulls/:id/brief', { schema: { params: IdParams } }, async (req): Promise<PrBriefState> => {
    const { workspaceId } = await getContext(container, req);
    return service.getState(workspaceId, req.params.id);
  });

  // POST may call the model: rate-limited like review runs; empty body = no force.
  app.post(
    '/pulls/:id/brief',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req): Promise<PrBriefState> => {
      const { workspaceId } = await getContext(container, req);
      const body = IntentRunRequest.parse(req.body ?? {});
      return service.run(workspaceId, req.params.id, { force: body.force, logger: req.log });
    },
  );
}
