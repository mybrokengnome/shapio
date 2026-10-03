import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { listAuditEvents } from '../../../controllers/auditLog.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import { listAuditSchema } from './schemas.js';

/** The audit log, newest first, filtered and cursor-paginated. */
export const adminAuditRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  // GET /api/admin/audit
  app.get(
    '/',
    { schema: listAuditSchema, preHandler: app.requireGlobalPermission('audit.read') },
    listAuditEvents,
  );
};
