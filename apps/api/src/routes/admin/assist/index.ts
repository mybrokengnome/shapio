import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ASSIST_RATE_LIMIT_WINDOW_MS } from '../../../constants/assist.js';
import * as handlers from '../../../controllers/assist.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import { createPerActorRateLimit } from '../rateLimits.js';
import * as schemas from './schemas.js';

/**
 * /api/admin/assist (plan agentic-ecosystem §A0, §I). Agents propose, people ship: every action returns a
 * proposal or writes drafts into a change set; nothing publishes. With AI_PROVIDER unset only `GET /status`
 * exists (it answers `enabled: false`) and no request ever reaches a model provider.
 * Permissions are those of what each action maps to: media (alt text), the model's read/update (summarize,
 * translate), schema.create (schema drafts), and per rule for content-ops (checked by the services).
 */
export const adminAssistRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');

  // GET /status: on/off, provider and model (never the key or endpoint), this month's usage
  app.get(
    '/status',
    { schema: schemas.assistStatusSchema, preHandler: app.requireAdmin },
    handlers.getStatus,
  );

  if (!app.assist) {
    return;
  }
  const limit = createPerActorRateLimit(app, 'assist', {
    max: app.config.assist.rateLimitMax,
    timeWindow: ASSIST_RATE_LIMIT_WINDOW_MS,
  });
  const admin = [app.requireAdmin, limit];

  // POST /alt-text { assetId, locale? } → { alt, model }
  app.post(
    '/alt-text',
    {
      schema: schemas.altTextSchema,
      preHandler: [app.requireGlobalPermission('media.read'), limit],
      config: { audit: { action: 'assist.alt_text' } },
    },
    handlers.altText,
  );
  // POST /summarize { modelKey, entryId, locale?, fieldApiKey } → { text, truncated, model }
  app.post(
    '/summarize',
    { schema: schemas.summarizeSchema, preHandler: admin, config: { audit: { action: 'assist.summarize' } } },
    handlers.summarize,
  );
  // POST /translate { modelKey, entryId, from, to } → { data, issues, model }
  app.post(
    '/translate',
    { schema: schemas.translateSchema, preHandler: admin, config: { audit: { action: 'assist.translate' } } },
    handlers.translate,
  );
  // POST /rewrite { text, instruction, maxLength? } → { text, truncated, model }
  app.post(
    '/rewrite',
    { schema: schemas.rewriteSchema, preHandler: admin, config: { audit: { action: 'assist.rewrite' } } },
    handlers.rewrite,
  );
  // POST /schema/draft { description } → { definitions, model }; writes nothing
  app.post(
    '/schema/draft',
    {
      schema: schemas.schemaDraftSchema,
      preHandler: [app.requireGlobalPermission('schema.create'), limit],
      config: { audit: { action: 'assist.schema_draft' } },
    },
    handlers.schemaDraft,
  );
  // POST /content-ops/propose { rule, modelKey?, fromLocale? } → 202 { runId }
  app.post(
    '/content-ops/propose',
    {
      schema: schemas.proposeContentOpsSchema,
      preHandler: admin,
      config: { audit: { action: 'assist.content_ops' } },
    },
    handlers.proposeContentOpsRun,
  );
  // GET /content-ops/:runId → the run's status and, once done, its result
  app.get(
    '/content-ops/:runId',
    { schema: schemas.contentOpsRunSchema, preHandler: app.requireAdmin },
    handlers.getContentOpsRunView,
  );
};
