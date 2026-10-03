import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../controllers/previewContent.js';
import { declareSiteScope } from '../../plugins/siteResolution.js';
import {
  ContentQuerySchema,
  DeliveryResponseSchema,
  RouteEntryParamsSchema,
  RouteParamsSchema,
} from '../schemas/content.js';
import { ErrorResponseSchema } from '../schemas/error.js';

/**
 * /api/preview/content/:modelKey[/:id]: draft content for site previews, addressed by route key like
 * delivery (plural API ID of a collection), authorised by a preview token in
 * `Authorization: Bearer shpv_…` (never a query parameter, so tokens stay out of access logs).
 */
export const previewRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  // The preview token is not an app-user JWT: the app-user plugin must leave this bearer alone.
  const config = { appToken: 'ignore' as const };
  const response = {
    200: DeliveryResponseSchema,
    401: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
  };
  // GET /content/:modelKey
  app.get(
    '/content/:modelKey',
    { schema: { params: RouteParamsSchema, querystring: ContentQuerySchema, response }, config },
    handlers.listPreview,
  );
  // GET /content/:modelKey/:id
  app.get(
    '/content/:modelKey/:id',
    { schema: { params: RouteEntryParamsSchema, querystring: ContentQuerySchema, response }, config },
    handlers.getPreview,
  );
};
