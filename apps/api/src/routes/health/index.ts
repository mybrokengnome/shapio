import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { getHealth, getReady, getVersion } from '../../controllers/health.js';
import { getHealthSchema, getReadySchema, getVersionSchema } from './schemas.js';

/** Liveness, readiness and version. Unauthenticated and exempt from the global rate limit (probes). */
export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const config = { rateLimit: false } as const;
  // GET /api/health: the process is up (no dependencies checked).
  app.get('/health', { schema: getHealthSchema, config }, getHealth);
  // GET /api/ready: the database answers and migrations are current.
  app.get('/ready', { schema: getReadySchema, config }, getReady);
  // GET /api/version
  app.get('/version', { schema: getVersionSchema, config }, getVersion);
};
