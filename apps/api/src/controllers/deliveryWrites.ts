import type { FastifyReply, FastifyRequest } from 'fastify';
import { apiKeyOfRoute } from '../content/model.js';
import * as deliveryWritesService from '../services/contentDeliveryWrites.js';
import { contentContextFor } from './contentContext.js';

/** `:modelKey` is the route key: the plural API ID of a collection, the API ID of a singleton. */
type ModelParams = { modelKey: string };
type EntryParams = ModelParams & { id: string };

type CreateRequest = FastifyRequest<{
  Params: ModelParams;
  Body: deliveryWritesService.DeliveryCreateInput;
}>;
type UpdateRequest = FastifyRequest<{
  Params: EntryParams;
  Body: deliveryWritesService.DeliveryUpdateInput;
}>;

export const createDeliveryEntry = async (request: CreateRequest, reply: FastifyReply) => {
  const context = await contentContextFor(request);
  const apiKey = apiKeyOfRoute(context.snapshot, request.params.modelKey);
  return reply.code(201).send(await deliveryWritesService.createDeliveryEntry(context, apiKey, request.body));
};

export const updateDeliveryEntry = async (request: UpdateRequest) => {
  const context = await contentContextFor(request);
  const apiKey = apiKeyOfRoute(context.snapshot, request.params.modelKey);
  return deliveryWritesService.updateDeliveryEntry(context, apiKey, request.params.id, request.body);
};

export const deleteDeliveryEntry = async (
  request: FastifyRequest<{ Params: EntryParams }>,
  reply: FastifyReply,
) => {
  const context = await contentContextFor(request);
  await deliveryWritesService.deleteDeliveryEntry(
    context,
    apiKeyOfRoute(context.snapshot, request.params.modelKey),
    request.params.id,
  );
  return reply.code(204).send();
};
