import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  createLocale,
  deleteLocale,
  listLocales,
  setDefaultLocale,
  updateLocale,
} from '../../../controllers/locales.js';
import * as schemas from './schemas.js';

/** /api/admin/locales: content locales (code, label, default, fallback chain). */
export const localesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const manager = { preHandler: app.requireGlobalPermission('schema.create') };

  // GET /
  app.get('/', { preHandler: app.requireAdmin, schema: schemas.listLocalesSchema }, listLocales);
  // POST /
  app.post(
    '/',
    { ...manager, schema: schemas.createLocaleSchema, config: { audit: { action: 'locale.create' } } },
    createLocale,
  );
  // PUT /:code: label and fallback chain
  app.put(
    '/:code',
    { ...manager, schema: schemas.updateLocaleSchema, config: { audit: { action: 'locale.update' } } },
    updateLocale,
  );
  // POST /:code/default: make this the default locale (a contract change; needs acknowledgeBreaking)
  app.post(
    '/:code/default',
    { ...manager, schema: schemas.setDefaultLocaleSchema, config: { audit: { action: 'locale.update' } } },
    setDefaultLocale,
  );
  // DELETE /:code?acknowledgeDestructive=true: remove the locale and purge its content
  app.delete(
    '/:code',
    { ...manager, schema: schemas.deleteLocaleSchema, config: { audit: { action: 'locale.delete' } } },
    deleteLocale,
  );
};
