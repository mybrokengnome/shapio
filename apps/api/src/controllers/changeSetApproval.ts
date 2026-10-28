import type { FastifyRequest } from 'fastify';
import type { ApprovalNoteBody, RequestChangesBody } from '../routes/admin/changeSets/approvalSchemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as approvalService from '../services/changeSetApproval.js';
import { contentContextFor } from './contentContext.js';

/** Approval workflows on change sets (plan approval-workflows): the routes under /api/admin/change-sets/:id/approval. */
const contextFor = async (request: FastifyRequest) => ({
  ...(await contentContextFor(request)),
  ports: request.server.schemaContent,
});

type WithNote = FastifyRequest<{ Params: IdParams; Body: ApprovalNoteBody }>;

export const requestApproval = async (request: WithNote) =>
  approvalService.requestApproval(await contextFor(request), request.params.id, request.body);

export const approve = async (request: WithNote) =>
  approvalService.approveChangeSet(await contextFor(request), request.params.id, request.body);

export const requestChanges = async (
  request: FastifyRequest<{ Params: IdParams; Body: RequestChangesBody }>,
) => approvalService.requestChanges(await contextFor(request), request.params.id, request.body);

export const clearApproval = async (request: FastifyRequest<{ Params: IdParams }>) =>
  approvalService.clearApproval(await contextFor(request), request.params.id);
