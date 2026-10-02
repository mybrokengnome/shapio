import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { createToken, listTokens, revokeToken } from '../../../controllers/apiTokens.js';
import { createTokenSchema, listTokensSchema, revokeTokenSchema } from './schemas.js';

/** API tokens: each bound to one role, shown once, stored hashed. */
export const adminTokensRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const manageTokens = { preHandler: app.requireGlobalPermission('tokens.manage') };

  // GET /api/admin/tokens
  app.get('/', { schema: listTokensSchema, ...manageTokens }, listTokens);
  // POST /api/admin/tokens
  app.post(
    '/',
    { schema: createTokenSchema, config: { audit: { action: 'api_token.create' } }, ...manageTokens },
    createToken,
  );
  // DELETE /api/admin/tokens/:id: revoke.
  app.delete(
    '/:id',
    { schema: revokeTokenSchema, config: { audit: { action: 'api_token.revoke' } }, ...manageTokens },
    revokeToken,
  );
};
