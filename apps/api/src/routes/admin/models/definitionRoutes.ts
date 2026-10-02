import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { createDefinitionControllers } from '../../../controllers/schemaDefinitions.js';
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
    const handlers = createDefinitionControllers(category);
    const schemas = definitionRouteSchemas(category);
    const admin = { preHandler: app.requireAdmin };
    const creator = { preHandler: app.requireGlobalPermission('schema.create') };

    // GET /: active definitions the caller may see
    app.get('/', { ...admin, schema: schemas.list }, handlers.list);
    // POST /: create (activates live)
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
    app.get('/:id', { ...admin, schema: schemas.get }, handlers.get);
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
    // DELETE /:id?expectedVersion=N: soft delete (entries are kept)
    app.delete(
      '/:id',
      { ...admin, schema: schemas.remove, config: { audit: { action: 'schema.delete' } } },
      handlers.remove,
    );
    // GET /:id/revisions, GET /:id/revisions/:revisionId
    app.get('/:id/revisions', { ...admin, schema: schemas.listRevisions }, handlers.listRevisions);
    app.get('/:id/revisions/:revisionId', { ...admin, schema: schemas.getRevision }, handlers.getRevision);
    // GET /:id/changes: planned changes (prerequisite jobs) and their outcome
    app.get('/:id/changes', { ...admin, schema: schemas.listChanges }, handlers.listChanges);
  };
