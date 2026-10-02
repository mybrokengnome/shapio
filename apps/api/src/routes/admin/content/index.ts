import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../../controllers/adminContent.js';
import * as schemas from './schemas.js';

const SAVE = { exempt: 'content saves are recorded as revisions' } as const;

/**
 * /api/admin/content/:modelKey: entries of any model, resolved through the registry at request time
 * (CONTRIBUTING.md rule 2). Admin principals only; per-model permissions, field masks and row filters are
 * enforced by the services through the evaluator.
 */
export const adminContentRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const admin = { preHandler: app.requireAdmin };

  // GET /:modelKey: drafts, with filters/sort/pagination/populate/fields/locale/q
  app.get('/:modelKey', { ...admin, schema: schemas.listEntriesSchema }, handlers.listEntries);
  // POST /:modelKey
  app.post(
    '/:modelKey',
    { ...admin, schema: schemas.createEntrySchema, config: { audit: SAVE } },
    handlers.createEntry,
  );
  // GET /:modelKey/:id?locale=
  app.get('/:modelKey/:id', { ...admin, schema: schemas.getEntrySchema }, handlers.getEntry);
  // PUT /:modelKey/:id: save (or autosave) one locale's draft with the expected version (409 when stale)
  app.put(
    '/:modelKey/:id',
    { ...admin, schema: schemas.updateEntrySchema, config: { audit: SAVE } },
    handlers.updateEntry,
  );
  // DELETE /:modelKey/:id
  app.delete(
    '/:modelKey/:id',
    { ...admin, schema: schemas.deleteEntrySchema, config: { audit: { action: 'content.delete' } } },
    handlers.deleteEntry,
  );
  // POST /:modelKey/:id/duplicate
  app.post(
    '/:modelKey/:id/duplicate',
    { ...admin, schema: schemas.duplicateEntrySchema, config: { audit: SAVE } },
    handlers.duplicateEntry,
  );
  // POST /:modelKey/:id/publish { locales }: publish one or more locales atomically
  app.post(
    '/:modelKey/:id/publish',
    { ...admin, schema: schemas.publishEntrySchema, config: { audit: { action: 'content.publish' } } },
    handlers.publishEntry,
  );
  // POST /:modelKey/:id/unpublish { locales }
  app.post(
    '/:modelKey/:id/unpublish',
    { ...admin, schema: schemas.publishEntrySchema, config: { audit: { action: 'content.unpublish' } } },
    handlers.unpublishEntry,
  );
  // GET /:modelKey/:id/revisions?locale=
  app.get(
    '/:modelKey/:id/revisions',
    { ...admin, schema: schemas.listRevisionsSchema },
    handlers.listRevisions,
  );
  // GET /:modelKey/:id/revisions/:revisionId
  app.get(
    '/:modelKey/:id/revisions/:revisionId',
    { ...admin, schema: schemas.getRevisionSchema },
    handlers.getRevision,
  );
  // POST /:modelKey/:id/revisions/:revisionId/restore { expectedVersion }
  app.post(
    '/:modelKey/:id/revisions/:revisionId/restore',
    { ...admin, schema: schemas.restoreRevisionSchema, config: { audit: { action: 'content.restore' } } },
    handlers.restoreRevision,
  );
};
