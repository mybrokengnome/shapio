import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { completeSetup, getSetupStatus } from '../../../controllers/setup.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import { CREDENTIAL_ROUTE_CONFIG } from '../rateLimits.js';
import { completeSetupSchema, getSetupStatusSchema } from './schemas.js';

/** First-run setup: create the first owner (with the logged one-time token when SETUP_REQUIRE_TOKEN is set). */
export const adminSetupRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  // GET /api/admin/setup: whether setup is still needed (no admin exists) and whether it needs the token.
  app.get('/', { schema: getSetupStatusSchema }, getSetupStatus);
  // POST /api/admin/setup
  app.post(
    '/',
    {
      schema: completeSetupSchema,
      config: { audit: { action: 'setup.complete' }, ...CREDENTIAL_ROUTE_CONFIG },
    },
    completeSetup,
  );
};
