import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExport, CiExportInput, CiInstallationView, CiPreview } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CI_EXPORT_RATE_LIMIT } from './constants.js';
import { CiService } from './service.js';

const RepoQuery = z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'expected owner/name') });

/**
 * Export to CI (L07, specs/export-to-ci.md §6.1).
 *   POST /agents/:id/ci/preview      → the files an export would write (reads GitHub, writes nothing)
 *   POST /agents/:id/export-ci       → commit to `devdigest/ci` + open/update the PR, upsert the installation
 *   POST /agents/:id/export-ci/zip   → the same files as application/zip, upsert the installation (pending)
 *   GET  /agents/:id/ci/installations → the agent's installations (CI tab)
 *   GET  /ci/installations?repo=     → every installation on a repo in the workspace (wizard occupancy)
 * None returns a secret value (AC-CI-75); GitHub goes through container.github (AC-CI-77).
 */
export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new CiService(container);

  app.post(
    '/agents/:id/ci/preview',
    {
      schema: { params: IdParams, body: CiExportInput, response: { 200: CiPreview } },
      config: { rateLimit: CI_EXPORT_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.preview(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/export-ci',
    {
      schema: { params: IdParams, body: CiExportInput, response: { 200: CiExport } },
      config: { rateLimit: CI_EXPORT_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.exportPr(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/export-ci/zip',
    { schema: { params: IdParams, body: CiExportInput }, config: { rateLimit: CI_EXPORT_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const zip = await service.exportZip(workspaceId, req.params.id, req.body);
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${zip.filename}"`)
        .send(Buffer.from(zip.bytes));
    },
  );

  app.get(
    '/agents/:id/ci/installations',
    { schema: { params: IdParams, response: { 200: z.array(CiInstallationView) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listForAgent(workspaceId, req.params.id);
    },
  );

  app.get(
    '/ci/installations',
    { schema: { querystring: RepoQuery, response: { 200: z.array(CiInstallationView) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listForRepo(workspaceId, req.query.repo);
    },
  );
}
