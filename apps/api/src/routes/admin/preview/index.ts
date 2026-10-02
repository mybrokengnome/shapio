import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../../controllers/previewTokens.js';
import * as schemas from './schemas.js';

/**
 * /api/admin/preview: preview tokens. Any admin who may read a model can create tokens for it (checked per
 * model by the service); creators revoke their own, `tokens.manage` revokes any.
 */
export const adminPreviewRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const admin = { preHandler: app.requireAdmin };
  app.get('/tokens', { schema: schemas.listPreviewTokensSchema, ...admin }, handlers.listPreviewTokens);
  app.post(
    '/tokens',
    {
      schema: schemas.createPreviewTokenSchema,
      config: { audit: { action: 'preview_token.create' } },
      ...admin,
    },
    handlers.createPreviewToken,
  );
  app.delete(
    '/tokens/:id',
    {
      schema: schemas.revokePreviewTokenSchema,
      config: { audit: { action: 'preview_token.revoke' } },
      ...admin,
    },
    handlers.revokePreviewToken,
  );
  // POST /open { modelKey, entryId, locale?, connectionId? }: the entry form's Preview button
  app.post(
    '/open',
    { schema: schemas.openPreviewSchema, config: { audit: { action: 'preview_token.create' } }, ...admin },
    handlers.openPreview,
  );
};
