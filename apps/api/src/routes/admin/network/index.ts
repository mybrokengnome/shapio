import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { getNetworkApproval, updateNetworkApproval } from '../../../controllers/networkApproval.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import { getNetworkApprovalSchema, updateNetworkApprovalSchema } from './schemas.js';

/**
 * /api/admin/network: instance-wide settings every site inherits (plan approval-workflows). The default
 * approval workflow is managed by whoever manages sites (`sites.manage`, a network action).
 */
export const adminNetworkRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  const manageSites = { preHandler: app.requireGlobalPermission('sites.manage') };
  // GET /api/admin/network/approval: the default workflow and which sites follow it
  app.get('/approval', { schema: getNetworkApprovalSchema, ...manageSites }, getNetworkApproval);
  // PUT /api/admin/network/approval { expectedVersion, workflow }: null turns approval off by default
  app.put(
    '/approval',
    {
      schema: updateNetworkApprovalSchema,
      config: { audit: { action: 'network.approval_update' } },
      ...manageSites,
    },
    updateNetworkApproval,
  );
};
