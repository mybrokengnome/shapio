import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { createDefinitionControllers } from '../../../controllers/schemaDefinitions.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import type { DefinitionCategory } from '../../../services/schemaDefinitions.js';
import { definitionRouteSchemas } from './schemas.js';

const PREVIEW = { exempt: 'plan preview; writes nothing' } as const;

/**
 * The definition routes, mounted once for models (/api/admin/models) and once for components
 * (/api/admin/components). Generic: no route exists per model (CONTRIBUTING.md rule 2).
 */
export const createDefinitionRoutes =
  (category: DefinitionCategory): FastifyPluginAsyncTypebox =>
  async (app) => {
    // Site routes (plan site-schema): the request's site is the view definitions resolve in (shared ones
    // and the site's own), where creates land by default, and whose roles may grant schema permission on
    // its own definitions. The services check `schema.create` / `schemaManage` per scope.
    declareSiteScope(app, 'site');
    const handlers = createDefinitionControllers(category);
    const schemas = definitionRouteSchemas(category);
    const admin = { preHandler: app.requireAdmin };
    const siteRead = admin;
    const creator = admin;

    // GET /?scope=network: active definitions of the site's view the caller may see (shared ones only)
    app.get('/', { ...siteRead, schema: schemas.list }, handlers.list);
    // POST /: create (activates live) on the site, or shared with `scope: 'network'`
    app.post(
      '/',
      { ...creator, schema: schemas.create, config: { audit: { action: 'schema.activate' } } },
      handlers.create,
    );
    // POST /plan: preview a create
    app.post(
      '/plan',
      { ...creator, schema: schemas.planCreate, config: { audit: PREVIEW } },
      handlers.planCreate,
    );
    // GET /:id
    app.get('/:id', { ...siteRead, schema: schemas.get }, handlers.get);
    // PUT /:id: change with the expected version (409 when stale)
    app.put(
      '/:id',
      { ...admin, schema: schemas.update, config: { audit: { action: 'schema.activate' } } },
      handlers.update,
    );
    // POST /:id/plan: classification, impact and prerequisites of a proposed change
    app.post(
      '/:id/plan',
      { ...admin, schema: schemas.planUpdate, config: { audit: PREVIEW } },
      handlers.planUpdate,
    );
    // PUT /:id/scope { scope, siteId?, version }: share with all sites, or keep on one site
    app.put(
      '/:id/scope',
      { ...admin, schema: schemas.changeScope, config: { audit: { action: 'schema.scope' } } },
      handlers.changeScope,
    );
    // DELETE /:id?expectedVersion=N: soft delete (entries are kept)
    app.delete(
      '/:id',
      { ...admin, schema: schemas.remove, config: { audit: { action: 'schema.delete' } } },
      handlers.remove,
    );
    // GET /:id/revisions, GET /:id/revisions/:revisionId
    app.get('/:id/revisions', { ...siteRead, schema: schemas.listRevisions }, handlers.listRevisions);
    app.get('/:id/revisions/:revisionId', { ...siteRead, schema: schemas.getRevision }, handlers.getRevision);
    // GET /:id/changes: planned changes (prerequisite jobs) and their outcome
    app.get('/:id/changes', { ...siteRead, schema: schemas.listChanges }, handlers.listChanges);
  };
