import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ContextAttachRequest,
  ContextAttachment,
  ContextFile,
  ContextList,
  ContextRoots,
  ContextRootsUpdate,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ContextService } from './service.js';
import type { ContextOwnerKind } from './types.js';

const ListQuery = z.object({ q: z.string().optional() });
const FileQuery = z.object({ path: z.string() });
const RepoQuery = z.object({ repo_id: z.string().uuid() });
const DocParams = z.object({ id: z.string().uuid(), docId: z.string().uuid() });

/**
 * Project Context folder. Routes only validate, resolve the workspace and call
 * ContextService. There is deliberately no write, edit or re-index endpoint.
 *   GET|PUT /repos/:id/context/roots
 *   GET     /repos/:id/context?q=            list (metadata only)
 *   GET     /repos/:id/context/file?path=    read-only preview
 *   GET|POST /agents|skills/:id/context-docs?repo_id=
 *   DELETE  /agents|skills/:id/context-docs/:docId
 */
export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ContextService(app.container);

  app.get(
    '/repos/:id/context/roots',
    { schema: { params: IdParams, response: { 200: ContextRoots } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getRoots(workspaceId, req.params.id);
    },
  );

  app.put(
    '/repos/:id/context/roots',
    { schema: { params: IdParams, body: ContextRootsUpdate, response: { 200: ContextRoots } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.putRoots(workspaceId, req.params.id, req.body.roots);
    },
  );

  app.get(
    '/repos/:id/context',
    { schema: { params: IdParams, querystring: ListQuery, response: { 200: ContextList } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, req.params.id, req.query.q);
    },
  );

  app.get(
    '/repos/:id/context/file',
    { schema: { params: IdParams, querystring: FileQuery, response: { 200: ContextFile } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.preview(workspaceId, req.params.id, req.query.path);
    },
  );

  const owners: { prefix: string; kind: ContextOwnerKind }[] = [
    { prefix: 'agents', kind: 'agent' },
    { prefix: 'skills', kind: 'skill' },
  ];
  for (const { prefix, kind } of owners) {
    app.get(
      `/${prefix}/:id/context-docs`,
      { schema: { params: IdParams, querystring: RepoQuery, response: { 200: z.array(ContextAttachment) } } },
      async (req) => {
        const { workspaceId } = await getContext(app.container, req);
        return service.listAttachments(workspaceId, kind, req.params.id, req.query.repo_id);
      },
    );

    app.post(
      `/${prefix}/:id/context-docs`,
      {
        schema: {
          params: IdParams,
          querystring: RepoQuery,
          body: ContextAttachRequest,
          response: { 200: ContextAttachment, 201: ContextAttachment },
        },
      },
      async (req, reply) => {
        const { workspaceId } = await getContext(app.container, req);
        const { attachment, created } = await service.attach(
          workspaceId,
          kind,
          req.params.id,
          req.query.repo_id,
          req.body.path,
        );
        reply.status(created ? 201 : 200);
        return attachment;
      },
    );

    app.delete(`/${prefix}/:id/context-docs/:docId`, { schema: { params: DocParams } }, async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.detach(workspaceId, kind, req.params.id, req.params.docId);
      return { ok: true };
    });
  }
}
