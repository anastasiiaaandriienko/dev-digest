import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillCreate, SkillUpdate } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SkillsService } from './service.js';

/** `/skills/:id/versions/:version/restore` — id is a uuid, version a positive integer. */
const VersionParams = IdParams.extend({ version: z.coerce.number().int().positive() });

/**
 * Skills Lab — skills module (HW2 #8). Workspace-scoped CRUD over `skills`,
 * with body history in `skill_versions`.
 *   GET    /skills       → list (each with agent_count)
 *   GET    /skills/:id   → one skill
 *   POST   /skills       → create (version 1)                       → 201
 *   PUT    /skills/:id   → partial update; a changed body bumps the version
 *   DELETE /skills/:id   → delete (versions + agent links cascade; agents stay)
 *   GET    /skills/:id/versions                  → body history, newest first
 *   POST   /skills/:id/versions/:version/restore → old body as a NEW version (no-op if current)
 * Routes only validate, resolve the workspace and call SkillsService.
 */
export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });

  app.post('/skills', { schema: { body: SkillCreate } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, req.body);
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: SkillUpdate } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.update(workspaceId, req.params.id, req.body);
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listVersions(workspaceId, req.params.id);
  });

  app.post('/skills/:id/versions/:version/restore', { schema: { params: VersionParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.restoreVersion(workspaceId, req.params.id, req.params.version);
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.delete(workspaceId, req.params.id);
    return { ok: true };
  });
}
