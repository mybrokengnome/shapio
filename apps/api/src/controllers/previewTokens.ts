import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  CreatePreviewTokenBody,
  ListPreviewTokensQuery,
  OpenPreviewBody,
} from '../routes/admin/preview/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as previewTokensService from '../services/previewTokens.js';
import { contentContextFor } from './contentContext.js';

export const listPreviewTargets = async (request: FastifyRequest) =>
  previewTokensService.listPreviewTargets(await contentContextFor(request), request.server.publishing);

export const listPreviewTokens = async (request: FastifyRequest<{ Querystring: ListPreviewTokensQuery }>) =>
  previewTokensService.listPreviewTokens(await contentContextFor(request), request.query);

export const createPreviewToken = async (
  request: FastifyRequest<{ Body: CreatePreviewTokenBody }>,
  reply: FastifyReply,
) =>
  reply
    .code(201)
    .send(
      await previewTokensService.createPreviewToken(
        await contentContextFor(request),
        request.server.publishing,
        request.body,
      ),
    );

export const revokePreviewToken = async (
  request: FastifyRequest<{ Params: IdParams }>,
  reply: FastifyReply,
) => {
  await previewTokensService.revokePreviewToken(await contentContextFor(request), request.params.id, {
    canManageAll: await request.server.permissions.canPerform(request.principal, 'tokens.manage'),
  });
  return reply.code(204).send();
};

export const openPreview = async (request: FastifyRequest<{ Body: OpenPreviewBody }>) =>
  previewTokensService.openPreview(await contentContextFor(request), request.server.publishing, request.body);
