import type { FastifyReply, FastifyRequest } from 'fastify';
import { apiKeyOfRoute } from '../content/model.js';
import { AppError } from '../helpers/appError.js';
import { refuseInterfaceWrite } from '../services/contentAccess.js';
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

/**
 * `preValidation` of the write routes (after authentication, which `onRequest` resolves): an interface's route
 * has no entries of its own (plan interfaces), so an authenticated write there is refused with 405 before its
 * body is validated, whatever the body holds. An anonymous caller gets the 401 an anonymous reader gets, and
 * learns nothing of the interface or its members (public delivery never shows schema shape to them).
 */
export const refuseInterfaceRouteWrite = async (request: FastifyRequest<{ Params: ModelParams }>) => {
  const context = await contentContextFor(request);
  const contract = context.snapshot.interfacesByRouteKey.get(request.params.modelKey);
  if (!contract || context.snapshot.modelsByRouteKey.has(request.params.modelKey)) {
    return;
  }
  if (context.actor.kind === 'anonymous') {
    throw new AppError(401, 'UNAUTHENTICATED', 'This content needs a delivery token');
  }
  refuseInterfaceWrite(context.snapshot, contract.definition.apiKey, 'update');
};

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
