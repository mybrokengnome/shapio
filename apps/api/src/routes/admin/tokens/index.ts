import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { createToken, listTokens, revokeToken, updateToken } from '../../../controllers/apiTokens.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import { createTokenSchema, listTokensSchema, revokeTokenSchema, updateTokenSchema } from './schemas.js';

/** API tokens: each bound to one role, shown once, stored hashed. */
export const adminTokensRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  const manageTokens = { preHandler: app.requireGlobalPermission('tokens.manage') };

  // GET /api/admin/tokens
  app.get('/', { schema: listTokensSchema, ...manageTokens }, listTokens);
  // POST /api/admin/tokens
  app.post(
    '/',
    { schema: createTokenSchema, config: { audit: { action: 'api_token.create' } }, ...manageTokens },
    createToken,
  );
  // PATCH /api/admin/tokens/:id: the schema version the token is pinned to.
  app.patch(
    '/:id',
    { schema: updateTokenSchema, config: { audit: { action: 'api_token.update' } }, ...manageTokens },
    updateToken,
  );
  // DELETE /api/admin/tokens/:id: revoke.
  app.delete(
    '/:id',
    { schema: revokeTokenSchema, config: { audit: { action: 'api_token.revoke' } }, ...manageTokens },
    revokeToken,
  );
};
