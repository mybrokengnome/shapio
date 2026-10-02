import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../../controllers/deployments.js';
import * as schemas from './schemas.js';

/**
 * /api/admin/deployments: connections (`deployments.manage`) and runs. Every admin may see runs (an editor
 * who published needs to see whether the site build failed, brief §7); triggering and retrying need
 * `deployments.trigger` (editors have it).
 */
export const adminDeploymentsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const manage = { preHandler: app.requireGlobalPermission('deployments.manage') };
  const admin = { preHandler: app.requireAdmin };
  const trigger = { preHandler: app.requireGlobalPermission('deployments.trigger') };
  const audited = (action: string) => ({ config: { audit: { action } }, ...manage });

  app.get('/connections', { schema: schemas.listConnectionsSchema, ...manage }, handlers.listConnections);
  app.post(
    '/connections',
    { schema: schemas.createConnectionSchema, ...audited('deployment_connection.create') },
    handlers.createConnection,
  );
  app.get('/connections/:id', { schema: schemas.getConnectionSchema, ...manage }, handlers.getConnection);
  app.patch(
    '/connections/:id',
    { schema: schemas.updateConnectionSchema, ...audited('deployment_connection.update') },
    handlers.updateConnection,
  );
  app.delete(
    '/connections/:id',
    { schema: schemas.deleteConnectionSchema, ...audited('deployment_connection.delete') },
    handlers.deleteConnection,
  );
  // POST /connections/:id/test: provider checks (no build is started)
  app.post(
    '/connections/:id/test',
    {
      schema: schemas.testConnectionSchema,
      config: { audit: { exempt: 'read-only check; changes nothing' } },
      ...manage,
    },
    handlers.testConnection,
  );
  // POST /connections/:id/runs: manual deploy
  app.post(
    '/connections/:id/runs',
    { schema: schemas.triggerRunSchema, config: { audit: { action: 'deployment.trigger' } }, ...trigger },
    handlers.triggerRun,
  );
  app.get('/runs', { schema: schemas.listRunsSchema, ...admin }, handlers.listRuns);
  app.get('/runs/:id', { schema: schemas.getRunSchema, ...admin }, handlers.getRun);
  app.post(
    '/runs/:id/retry',
    { schema: schemas.retryRunSchema, config: { audit: { action: 'deployment.retry' } }, ...trigger },
    handlers.retryRun,
  );
};
