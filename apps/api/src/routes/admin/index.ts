import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { adminAuditRoutes } from './audit/index.js';
import { adminAuthRoutes } from './auth/index.js';
import { adminEditingRoutes } from './editing/index.js';
import { adminRolesRoutes } from './roles/index.js';
import { adminSetupRoutes } from './setup/index.js';
import { adminSiteRoutes } from './site/index.js';
import { adminSitesRoutes } from './sites/index.js';
import { adminTokensRoutes } from './tokens/index.js';
import { adminUsageRoutes } from './usage/index.js';
import { adminUsersRoutes } from './users/index.js';

/**
 * Admin identity routes (package B) and the entry document's endpoints (pre-flight, content health,
 * presence, counts), registered under `${BASE_PATH}/api/admin`.
 */
export const adminIdentityRoutes: FastifyPluginAsyncTypebox = async (app) => {
  await app.register(adminSetupRoutes, { prefix: '/setup' });
  await app.register(adminAuthRoutes, { prefix: '/auth' });
  await app.register(adminUsersRoutes);
  await app.register(adminRolesRoutes, { prefix: '/roles' });
  await app.register(adminTokensRoutes, { prefix: '/tokens' });
  await app.register(adminAuditRoutes, { prefix: '/audit' });
  await app.register(adminEditingRoutes);
  await app.register(adminUsageRoutes, { prefix: '/usage' });
  await app.register(adminSitesRoutes, { prefix: '/sites' });
  await app.register(adminSiteRoutes, { prefix: '/site' });
};
