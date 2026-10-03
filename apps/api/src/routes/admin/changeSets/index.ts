import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../../controllers/changeSets.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import * as schemas from './schemas.js';

/**
 * /api/admin/change-sets: schema drafts and entry publications that ship as one publication snapshot
 * (developer-face plan §5). Needs `changes.manage`; entry items need update permission on their model when
 * added and publish permission when shipped, schema drafts need schema permission (checked by the services).
 * Shipping and scheduling a ship also need `changes.ship` (agentic plan §I).
 */
export const adminChangeSetsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  const manage = { preHandler: app.requireGlobalPermission('changes.manage') };
  const audited = (action: string) => ({ config: { audit: { action } }, ...manage });
  const shipping = (action: string) => ({
    config: { audit: { action } },
    preHandler: [app.requireGlobalPermission('changes.manage'), app.requireGlobalPermission('changes.ship')],
  });

  app.get('/', { schema: schemas.listChangeSetsSchema, ...manage }, handlers.listChangeSets);
  app.post(
    '/',
    { schema: schemas.createChangeSetSchema, ...audited('change_set.create') },
    handlers.createChangeSet,
  );
  // GET /unassigned: drafts no active change set holds yet
  app.get('/unassigned', { schema: schemas.listUnassignedSchema, ...manage }, handlers.getUnassigned);
  app.get('/:id', { schema: schemas.getChangeSetSchema, ...manage }, handlers.getChangeSet);
  app.patch(
    '/:id',
    { schema: schemas.updateChangeSetSchema, ...audited('change_set.update') },
    handlers.updateChangeSet,
  );
  app.post(
    '/:id/discard',
    { schema: schemas.changeSetActionSchema, ...audited('change_set.discard') },
    handlers.discardChangeSet,
  );
  // POST /:id/items { modelKey, entryId, locale?, action }
  app.post(
    '/:id/items',
    { schema: schemas.addEntryItemSchema, ...audited('change_set.item_add') },
    handlers.addEntryItem,
  );
  app.delete(
    '/:id/items/:itemId',
    { schema: schemas.removeItemSchema, ...audited('change_set.item_remove') },
    handlers.removeItem,
  );
  app.get(
    '/:id/schema/:definitionId',
    { schema: schemas.getSchemaDraftSchema, ...manage },
    handlers.getDraft,
  );
  // PUT /:id/schema/:definitionId { category, definition | null, baseVersion, expectedDraftVersion? }
  app.put(
    '/:id/schema/:definitionId',
    { schema: schemas.putSchemaDraftSchema, ...audited('change_set.schema_draft') },
    handlers.putDraft,
  );
  app.delete(
    '/:id/schema/:definitionId',
    { schema: schemas.deleteSchemaDraftSchema, ...audited('change_set.schema_draft_remove') },
    handlers.deleteDraft,
  );
  app.get('/:id/review', { schema: schemas.getReviewSchema, ...manage }, handlers.getReview);
  app.get('/:id/timeline', { schema: schemas.getTimelineSchema, ...manage }, handlers.getChangeSetTimeline);
  // POST /:id/ship { expectedVersion, acknowledge*, itemVersions? }: 200 shipped/failed inline, 202 shipping
  app.post('/:id/ship', { schema: schemas.shipSchema, ...shipping('change_set.ship') }, handlers.ship);
  app.post(
    '/:id/schedule',
    { schema: schemas.scheduleSchema, ...shipping('change_set.schedule') },
    handlers.schedule,
  );
  app.post(
    '/:id/unschedule',
    { schema: schemas.changeSetActionSchema, ...audited('change_set.unschedule') },
    handlers.unschedule,
  );
};
