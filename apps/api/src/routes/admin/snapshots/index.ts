import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../../controllers/changeSets.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import * as schemas from './schemas.js';

/**
 * /api/admin/snapshots: the publication snapshot ledger, and restore (an open change set that brings live
 * content back to snapshot N; it goes live only when shipped). Needs `changes.manage`.
 */
export const adminSnapshotsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  const manage = { preHandler: app.requireGlobalPermission('changes.manage') };

  app.get('/', { schema: schemas.listSnapshotsSchema, ...manage }, handlers.getSnapshots);
  app.get('/:seq', { schema: schemas.getSnapshotSchema, ...manage }, handlers.getSnapshotBySeq);
  app.post(
    '/:seq/restore',
    { schema: schemas.restoreSnapshotSchema, config: { audit: { action: 'change_set.create' } }, ...manage },
    handlers.restore,
  );
};
