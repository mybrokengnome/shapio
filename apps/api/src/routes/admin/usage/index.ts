import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { getFieldUsage } from '../../../controllers/usage.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import { fieldUsageSchema } from './schemas.js';

/** Field usage from delivery traffic (plan developer-face §5), for the people who manage API tokens. */
export const adminUsageRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  // GET /api/admin/usage/fields?modelId&days
  app.get(
    '/fields',
    { schema: fieldUsageSchema, preHandler: app.requireGlobalPermission('tokens.manage') },
    getFieldUsage,
  );
};
