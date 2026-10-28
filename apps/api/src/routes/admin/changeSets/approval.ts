import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../../controllers/changeSetApproval.js';
import * as schemas from './schemas.js';

/**
 * /api/admin/change-sets/:id/approval (plan approval). Asking for approval and clearing it need
 * `changes.manage`; approving and requesting changes also need `changes.approve`. Registered inside the
 * change-set routes' site scope.
 */
export const registerApprovalRoutes = (app: Parameters<FastifyPluginAsyncTypebox>[0]) => {
  const manage = app.requireGlobalPermission('changes.manage');
  const approver = [manage, app.requireGlobalPermission('changes.approve')];

  // POST /:id/approval/request { note? }
  app.post(
    '/:id/approval/request',
    {
      schema: schemas.approvalWithNoteSchema,
      config: { audit: { action: 'change_set.approval_request' } },
      preHandler: manage,
    },
    handlers.requestApproval,
  );
  // POST /:id/approval/approve { note? }: pins the approval to what the set holds now
  app.post(
    '/:id/approval/approve',
    {
      schema: schemas.approvalWithNoteSchema,
      config: { audit: { action: 'change_set.approve' } },
      preHandler: approver,
    },
    handlers.approve,
  );
  // POST /:id/approval/request-changes { note }
  app.post(
    '/:id/approval/request-changes',
    {
      schema: schemas.requestChangesSchema,
      config: { audit: { action: 'change_set.approval_request_changes' } },
      preHandler: approver,
    },
    handlers.requestChanges,
  );
  // POST /:id/approval/clear
  app.post(
    '/:id/approval/clear',
    {
      schema: schemas.changeSetActionSchema,
      config: { audit: { action: 'change_set.approval_clear' } },
      preHandler: manage,
    },
    handlers.clearApproval,
  );
};
