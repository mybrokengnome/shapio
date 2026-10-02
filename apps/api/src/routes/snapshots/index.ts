import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { getCurrentSnapshot, listSnapshotChanges } from '../../controllers/snapshots.js';
import { currentSnapshotSchema, snapshotChangesSchema } from './schemas.js';

/**
 * /api/snapshots: publication snapshots for delivery callers (plan developer-face §5). Same credentials as
 * `/api/content` (delivery tokens, app users, anonymous callers per the `public` role); only models the
 * caller may read are reported.
 */
export const snapshotsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // GET /api/snapshots/current
  app.get('/current', { schema: currentSnapshotSchema }, getCurrentSnapshot);
  // GET /api/snapshots/changes?from&to&after&limit
  app.get('/changes', { schema: snapshotChangesSchema }, listSnapshotChanges);
};
