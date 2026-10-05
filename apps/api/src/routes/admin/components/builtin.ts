import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ensureSeoComponent } from '../../../controllers/builtinComponents.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import { ensureSeoComponentSchema } from './builtinSchemas.js';

/** /api/admin/components/builtin: Shapio's built-in components, created on first use (plan seo-fields). */
export const builtinComponentsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  // POST /seo/ensure: the shared SEO component, created when missing (201) or returned as it is (200)
  app.post(
    '/seo/ensure',
    {
      schema: ensureSeoComponentSchema,
      preHandler: app.requireAdmin,
      config: { audit: { action: 'schema.activate' } },
    },
    ensureSeoComponent,
  );
};
