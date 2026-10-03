import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  applySchema,
  exportSchema,
  getChange,
  getSchemaSummary,
  getSettings,
  updateSettings,
} from '../../../controllers/schemaSync.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import * as schemas from './schemas.js';

/** Large schemas (hundreds of models) must fit in one apply request. */
const APPLY_BODY_LIMIT = 10 * 1024 * 1024;

/** /api/admin/schema: summary, git-like sync (export/apply), planned changes and the read-only lock. */
export const schemaRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  const admin = { preHandler: app.requireAdmin };

  // GET /: global schema version and every visible definition's version and hash
  app.get('/', { ...admin, schema: schemas.getSummarySchema }, getSchemaSummary);
  // GET /export: canonical definitions + lock data for `shapio schema pull`
  app.get('/export', { ...admin, schema: schemas.exportSchema }, exportSchema);
  // POST /apply: three-way apply for `shapio schema apply` (dryRun for `shapio schema diff`)
  app.post(
    '/apply',
    {
      ...admin,
      bodyLimit: APPLY_BODY_LIMIT,
      schema: schemas.applySchema,
      config: { audit: { action: 'schema.activate' } },
    },
    applySchema,
  );
  // GET /changes/:changeId: a planned change's status (pending, running, activated, failed)
  app.get('/changes/:changeId', { ...admin, schema: schemas.getChangeSchema }, getChange);
  // GET /settings, PUT /settings: the opt-in read-only lock
  app.get('/settings', { ...admin, schema: schemas.getSettingsSchema }, getSettings);
  app.put(
    '/settings',
    {
      preHandler: app.requireGlobalPermission('schema.create'),
      schema: schemas.updateSettingsSchema,
      config: { audit: { action: 'schema.settings.update' } },
    },
    updateSettings,
  );
};
