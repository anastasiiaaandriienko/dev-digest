import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionScanRequest, ConventionSkillCreate, ConventionUpdate } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConventionsService } from './service.js';

const StateQuery = z.object({ include_rejected: z.enum(['true', 'false']).default('false') });

/** A skill body may be up to 200k characters (up to ~800 KB as UTF-8 JSON). */
const SKILL_BODY_LIMIT = 2 * 1024 * 1024;

/**
 * Conventions Extractor (HW2 #38–#42). Routes only validate, resolve the
 * workspace and call ConventionsService.
 *   POST  /repos/:id/conventions/extract     → start a scan in the background → 202 (409 if one runs)
 *   GET   /repos/:id/conventions             → latest scan + candidates (?include_rejected=true)
 *   PATCH /conventions/:id                   → accept / reject / pending, edit rule + category
 *   GET   /repos/:id/conventions/skill-draft → repo-conventions draft from accepted candidates
 *   POST  /repos/:id/conventions/skill       → create it (409 on a taken name), optionally attach to an agent → 201
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams, body: ConventionScanRequest.default({}) } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const { scan } = await service.startScan(workspaceId, req.params.id, req.body);
      reply.status(202);
      return scan;
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams, querystring: StateQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.state(workspaceId, req.params.id, req.query.include_rejected === 'true');
  });

  app.patch('/conventions/:id', { schema: { params: IdParams, body: ConventionUpdate } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.update(workspaceId, req.params.id, req.body);
  });

  app.get('/repos/:id/conventions/skill-draft', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.skillDraft(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/skill',
    { bodyLimit: SKILL_BODY_LIMIT, schema: { params: IdParams, body: ConventionSkillCreate } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.createSkill(workspaceId, req.params.id, req.body);
      reply.status(201);
      return result;
    },
  );
}
