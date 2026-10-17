import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * HW-04 Blast Radius.
 *   GET /pulls/:id/blast → BlastRadius (changed symbols → callers file:line,
 *                          affected endpoints / crons, totals, degraded reason)
 *
 * Read-only over stored pr_files + the repo-intel index: no GitHub sync, no LLM.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req): Promise<BlastRadius> => {
    const { workspaceId } = await getContext(container, req);
    return service.forPull(workspaceId, req.params.id);
  });
}
