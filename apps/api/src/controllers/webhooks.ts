import type { FastifyReply, FastifyRequest } from 'fastify';
import { toActorContext } from '../helpers/requestContext.js';
import type {
  CreateWebhookBody,
  DeliveryParams,
  ListDeliveriesQuery,
  UpdateWebhookBody,
} from '../routes/admin/webhooks/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as webhooksService from '../services/webhooks.js';

type ById = FastifyRequest<{ Params: IdParams }>;

export const listWebhooks = async (request: FastifyRequest) =>
  webhooksService.listWebhooks(request.server.publishing);

export const listEventTypes = async () => ({ items: [...webhooksService.listEventTypes()] });

export const getWebhook = async (request: ById) =>
  webhooksService.getWebhook(request.server.publishing, request.params.id);

export const createWebhook = async (
  request: FastifyRequest<{ Body: CreateWebhookBody }>,
  reply: FastifyReply,
) =>
  reply
    .code(201)
    .send(
      await webhooksService.createWebhook(request.server.publishing, toActorContext(request), request.body),
    );

export const updateWebhook = async (request: FastifyRequest<{ Params: IdParams; Body: UpdateWebhookBody }>) =>
  webhooksService.updateWebhook(
    request.server.publishing,
    toActorContext(request),
    request.params.id,
    request.body,
  );

export const deleteWebhook = async (request: ById, reply: FastifyReply) => {
  await webhooksService.deleteWebhook(request.server.publishing, toActorContext(request), request.params.id);
  return reply.code(204).send();
};

export const rotateSecret = async (request: ById) =>
  webhooksService.rotateWebhookSecret(request.server.publishing, toActorContext(request), request.params.id);

export const testWebhook = async (request: ById, reply: FastifyReply) =>
  reply
    .code(202)
    .send(
      await webhooksService.sendTestDelivery(
        request.server.publishing,
        toActorContext(request),
        request.params.id,
      ),
    );

export const listDeliveries = async (
  request: FastifyRequest<{ Params: IdParams; Querystring: ListDeliveriesQuery }>,
) => webhooksService.listDeliveries(request.server.publishing, request.params.id, request.query);

export const redeliver = async (request: FastifyRequest<{ Params: DeliveryParams }>, reply: FastifyReply) =>
  reply
    .code(202)
    .send(
      await webhooksService.redeliver(
        request.server.publishing,
        toActorContext(request),
        request.params.id,
        request.params.deliveryId,
      ),
    );
