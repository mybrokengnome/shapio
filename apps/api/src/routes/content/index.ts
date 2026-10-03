import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../controllers/delivery.js';
import * as writeHandlers from '../../controllers/deliveryWrites.js';
import { declareSiteScope } from '../../plugins/siteResolution.js';
import {
  ContentQuerySchema,
  DeliveryResponseSchema,
  RouteEntryParamsSchema,
  RouteParamsSchema,
} from '../schemas/content.js';
import {
  createDeliveryEntrySchema,
  deleteDeliveryEntrySchema,
  updateDeliveryEntrySchema,
} from './writeSchemas.js';

const SAVE = { exempt: 'content saves are recorded as revisions' } as const;

/**
 * /api/content/:modelKey: the delivery API. `:modelKey` is the route key: the plural API ID of a collection
 * (`/api/content/articles`), the API ID of a singleton (`/api/content/homepage`). Reads serve published content only; delivery tokens, app users
 * and anonymous callers go through the same evaluator (anonymous callers get what the `public` app role
 * grants, nothing by default). Writes (package I) run the content service under the caller's policy: the
 * owner is set server-side and `ownedByPrincipal` limits updates and deletes to the caller's own entries.
 */
export const deliveryRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  const response = { 200: DeliveryResponseSchema, 304: { type: 'null' } };
  // GET /:modelKey
  app.get(
    '/:modelKey',
    { schema: { params: RouteParamsSchema, querystring: ContentQuerySchema, response } },
    handlers.listDelivery,
  );
  // GET /:modelKey/:id
  app.get(
    '/:modelKey/:id',
    { schema: { params: RouteEntryParamsSchema, querystring: ContentQuerySchema, response } },
    handlers.getDelivery,
  );
  // POST /:modelKey
  app.post(
    '/:modelKey',
    { schema: createDeliveryEntrySchema, config: { audit: SAVE } },
    writeHandlers.createDeliveryEntry,
  );
  // PUT /:modelKey/:id: save one locale's draft with the expected version (409 when stale)
  app.put(
    '/:modelKey/:id',
    { schema: updateDeliveryEntrySchema, config: { audit: SAVE } },
    writeHandlers.updateDeliveryEntry,
  );
  // DELETE /:modelKey/:id
  app.delete(
    '/:modelKey/:id',
    { schema: deleteDeliveryEntrySchema, config: { audit: { action: 'content.delete' } } },
    writeHandlers.deleteDeliveryEntry,
  );
};
