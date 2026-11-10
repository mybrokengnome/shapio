import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { getFieldUsage, getSchemaVersions } from '../../../controllers/usage.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import { fieldUsageSchema, schemaVersionsSchema } from './schemas.js';

/** Field usage from delivery traffic (plan developer-face §5), for the people who manage API tokens. */
export const adminUsageRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  // GET /api/admin/usage/fields?modelId&days
  app.get(
    '/fields',
    { schema: fieldUsageSchema, preHandler: app.requireGlobalPermission('tokens.manage') },
    getFieldUsage,
  );
  // GET /api/admin/usage/schema-versions: the schema version each reader of the workspace names now
  app.get(
    '/schema-versions',
    { schema: schemaVersionsSchema, preHandler: app.requireGlobalPermission('tokens.manage') },
    getSchemaVersions,
  );
};
