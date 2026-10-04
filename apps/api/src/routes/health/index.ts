import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { getHealth, getReady, getVersion } from '../../controllers/health.js';
import { declareSiteScope } from '../../plugins/siteResolution.js';
import { getHealthSchema, getReadySchema, getVersionSchema } from './schemas.js';

/** Liveness, readiness and version. Unauthenticated and exempt from the global rate limit (probes). */
export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  const config = { rateLimit: false } as const;
  // Probes run every few seconds: their response line is debug, so they do not flood the info log.
  const probeConfig = { ...config, requestLog: 'debug' } as const;
  // GET /api/health: the process is up (no dependencies checked).
  app.get('/health', { schema: getHealthSchema, config: probeConfig }, getHealth);
  // GET /api/ready: the database answers and migrations are current.
  app.get('/ready', { schema: getReadySchema, config: probeConfig }, getReady);
  // GET /api/version
  app.get('/version', { schema: getVersionSchema, config }, getVersion);
};
