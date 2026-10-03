import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import * as handlers from '../../controllers/deploymentCallbacks.js';
import { declareSiteScope } from '../../plugins/siteResolution.js';
import { UuidSchema } from '../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../schemas/error.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The exact request body, for signature verification (set by this plugin's JSON parser only). */
    rawBody?: string;
  }
}

export const CallbackBodySchema = Type.Object({
  runId: UuidSchema,
  status: Type.Union([Type.Literal('building'), Type.Literal('deployed'), Type.Literal('failed')]),
  logUrl: Type.Optional(Type.String({ maxLength: 2000 })),
  siteUrl: Type.Optional(Type.String({ maxLength: 2000 })),
  message: Type.Optional(Type.String({ maxLength: 2000 })),
});

/**
 * /api/hooks/deployments/:connectionId: signed build callbacks from sites (no session, no token: the HMAC
 * signature over the raw body is the credential). Encapsulated so its raw-body JSON parser applies here only.
 */
export const hooksRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: 64 * 1024 },
    (request, body, done) => {
      const text = typeof body === 'string' ? body : body.toString('utf8');
      request.rawBody = text;
      try {
        done(null, JSON.parse(text));
      } catch (error) {
        done(Object.assign(error as Error, { statusCode: 400 }), undefined);
      }
    },
  );
  app.post(
    '/deployments/:connectionId',
    {
      schema: {
        params: Type.Object({ connectionId: UuidSchema }),
        body: CallbackBodySchema,
        response: {
          200: Type.Object({ applied: Type.Boolean(), status: Type.String() }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      // The HMAC signature is the credential; an admin cookie that happens to travel along is irrelevant.
      config: {
        audit: { exempt: 'signed provider callback; recorded on the deployment run timeline' },
        csrf: false,
      },
    },
    handlers.receiveCallback,
  );
};
