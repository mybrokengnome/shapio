import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { BUNDLE_CONTENT_TYPE } from '../../../content/transfer/format.js';
import * as handlers from '../../../controllers/transfer.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import * as schemas from './schemas.js';

/**
 * /api/admin/transfer: content export and import (`shapio export` / `shapio import`). Bundles and media
 * files travel as raw streams (never buffered whole), so this scope passes those bodies through unparsed.
 * The service authorises every call as an instance administrator.
 */
export const adminTransferRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  const passThrough = (_request: unknown, payload: unknown, done: (error: null, body: unknown) => void) =>
    done(null, payload);
  app.addContentTypeParser(BUNDLE_CONTENT_TYPE, passThrough);
  app.addContentTypeParser('application/octet-stream', passThrough);
  const admin = { preHandler: app.requireAdmin };

  // GET /export?headsOnly=&includeUsers=: the bundle as NDJSON
  app.get('/export', { ...admin, schema: schemas.exportSchema }, handlers.exportBundle);
  // POST /import?dryRun=&prune=: NDJSON body; 200 with the plan (dry run) or 202 with the import job
  app.post(
    '/import',
    { ...admin, schema: schemas.importSchema, config: { audit: { action: 'transfer.import' } } },
    handlers.importBundle,
  );
  // GET /imports/:id: an import job's progress
  app.get('/imports/:id', { ...admin, schema: schemas.importStatusSchema }, handlers.getImportStatus);
  // GET /media/:assetId: an asset's original file (export --with-media)
  app.get('/media/:assetId', { ...admin, schema: schemas.getMediaFileSchema }, handlers.getMediaFile);
  // PUT /media/:assetId?storageKey=&sha256=&sizeBytes=&mimeType=: a bundle's file, before its import
  app.put(
    '/media/:assetId',
    {
      ...admin,
      schema: schemas.putMediaFileSchema,
      config: {
        audit: { exempt: 'stores a file named by an import bundle; the import is audited (transfer.import)' },
      },
    },
    handlers.putMediaFile,
  );
};
