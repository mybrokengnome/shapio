import type { FastifyReply, FastifyRequest } from 'fastify';
import { toSiteActorContext } from '../helpers/requestContext.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import type {
  CreateConnectionBody,
  ListRunsQuery,
  UpdateConnectionBody,
} from '../routes/admin/deployments/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as deploymentsService from '../services/deployments.js';

type ById = FastifyRequest<{ Params: IdParams }>;

export const listConnections = async (request: FastifyRequest) =>
  deploymentsService.listConnections(request.server.publishing, getRequestSite(request));

export const getConnection = async (request: ById) =>
  deploymentsService.getConnection(request.server.publishing, getRequestSite(request), request.params.id);

export const createConnection = async (
  request: FastifyRequest<{ Body: CreateConnectionBody }>,
  reply: FastifyReply,
) =>
  reply
    .code(201)
    .send(
      await deploymentsService.createConnection(
        request.server.publishing,
        toSiteActorContext(request),
        request.body,
      ),
    );

export const updateConnection = async (
  request: FastifyRequest<{ Params: IdParams; Body: UpdateConnectionBody }>,
) =>
  deploymentsService.updateConnection(
    request.server.publishing,
    toSiteActorContext(request),
    request.params.id,
    request.body,
  );

export const deleteConnection = async (request: ById, reply: FastifyReply) => {
  await deploymentsService.deleteConnection(
    request.server.publishing,
    toSiteActorContext(request),
    request.params.id,
  );
  return reply.code(204).send();
};

export const testConnection = async (request: ById) =>
  deploymentsService.testConnection(request.server.publishing, getRequestSite(request), request.params.id);

export const triggerRun = async (request: ById, reply: FastifyReply) =>
  reply
    .code(201)
    .send(
      await deploymentsService.triggerRun(
        request.server.publishing,
        toSiteActorContext(request),
        request.params.id,
      ),
    );

export const listRuns = async (request: FastifyRequest<{ Querystring: ListRunsQuery }>) =>
  deploymentsService.listRuns(request.server.publishing, getRequestSite(request), request.query);

export const getRun = async (request: ById) =>
  deploymentsService.getRun(request.server.publishing, getRequestSite(request), request.params.id);

export const retryRun = async (request: ById, reply: FastifyReply) =>
  reply
    .code(201)
    .send(
      await deploymentsService.retryRun(
        request.server.publishing,
        toSiteActorContext(request),
        request.params.id,
      ),
    );
