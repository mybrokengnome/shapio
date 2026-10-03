import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../../controllers/editing.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import * as schemas from './schemas.js';

const READ_ONLY = { exempt: 'read-only check; records health findings only' } as const;
const PRESENCE = { exempt: 'presence is advisory and expires within a minute' } as const;

/**
 * The entry document's endpoints (plan editor-experience §2, §9), under `/api/admin`. Admin principals only;
 * every service checks the model's permissions, row filters and read masks through the evaluator.
 */
export const adminEditingRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  const admin = { preHandler: app.requireAdmin };

  // POST /content/:modelKey/:id/preflight { locales }: what publishing would run into, without publishing
  app.post(
    '/content/:modelKey/:id/preflight',
    { ...admin, schema: schemas.preflightSchema, config: { audit: READ_ONLY } },
    handlers.runPreflight,
  );
  // GET /content-health?rule=&modelKey=&cursor=&limit=: open findings, newest first
  app.get('/content-health', { ...admin, schema: schemas.listFindingsSchema }, handlers.listFindings);
  // GET /content-health/summary: open findings per rule
  app.get(
    '/content-health/summary',
    { ...admin, schema: schemas.findingsSummarySchema },
    handlers.summarizeFindings,
  );
  // GET /content-counts: entries per readable model
  app.get('/content-counts', { ...admin, schema: schemas.contentCountsSchema }, handlers.countContent);
  // PUT /presence/:modelKey/:id { tabId, locale }: heartbeat; returns who else has the entry open
  app.put(
    '/presence/:modelKey/:id',
    { ...admin, schema: schemas.heartbeatSchema, config: { audit: PRESENCE } },
    handlers.heartbeat,
  );
  // GET /presence/:modelKey/:id
  app.get(
    '/presence/:modelKey/:id',
    { ...admin, schema: schemas.entryPresenceSchema },
    handlers.entryPresence,
  );
  // DELETE /presence/:modelKey/:id?tabId=: the tab closed the document
  app.delete(
    '/presence/:modelKey/:id',
    { ...admin, schema: schemas.leavePresenceSchema, config: { audit: PRESENCE } },
    handlers.leavePresence,
  );
  // GET /presence/:modelKey: everyone editing an entry of the model (list rows)
  app.get('/presence/:modelKey', { ...admin, schema: schemas.modelPresenceSchema }, handlers.modelPresence);
};
