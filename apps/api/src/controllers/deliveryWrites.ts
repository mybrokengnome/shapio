import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../helpers/appError.js';
import {
  entryModelWithPolicy,
  modelWithCreatePolicy,
  refuseInterfaceWrite,
  type ContentServiceContext,
} from '../services/contentAccess.js';
import { holdsAnyGrant } from '../services/contentDelivery.js';
import { clientRouteOf, openClientRoute } from '../services/contentDeliveryLens.js';
import * as deliveryWritesService from '../services/contentDeliveryWrites.js';
import { contextDeferringVersion } from './delivery.js';

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
 * The write's context and route in today's names: through a schema lens (plan schema-lenses) the route key is
 * the client's version's (404 for a model gone since, 409 `LENS_UNCOVERED` for a kind change).
 */
const lensedWrite = async (
  request: FastifyRequest<{ Params: ModelParams }>,
  /** The write's own authorization, as without a version: run before anything lens-specific. */
  authorize: (context: ContentServiceContext, apiKey: string) => Promise<unknown>,
) => {
  const { context: base, versionError } = await contextDeferringVersion(request);
  return openClientRoute(
    base,
    request.params.modelKey,
    versionError,
    (apiKey) => authorize(base, apiKey),
    () => holdsAnyGrant(base, ['create', 'update', 'delete']),
    ['create', 'update', 'delete'],
  );
};

/**
 * `preValidation` of the write routes (after authentication, which `onRequest` resolves): an interface's route
 * has no entries of its own (plan interfaces), so an authenticated write there is refused with 405 before its
 * body is validated, whatever the body holds. An anonymous caller gets the 401 an anonymous reader gets, and
 * learns nothing of the interface or its members (public delivery never shows schema shape to them).
 */
export const refuseInterfaceRouteWrite = async (request: FastifyRequest<{ Params: ModelParams }>) => {
  // A version error waits for the handler, after the write is authorized.
  const { context } = await contextDeferringVersion(request);
  // Names only (never a lens error before the write is authorized): the client's route in today's names.
  const routeKey = clientRouteOf(context, request.params.modelKey)?.routeKey ?? request.params.modelKey;
  const contract = context.snapshot.interfacesByRouteKey.get(routeKey);
  if (!contract || context.snapshot.modelsByRouteKey.has(routeKey)) {
    return;
  }
  if (context.actor.kind === 'anonymous') {
    throw new AppError(401, 'UNAUTHENTICATED', 'This content needs a delivery token');
  }
  refuseInterfaceWrite(context.snapshot, contract.definition.apiKey, 'update');
};

export const createDeliveryEntry = async (request: CreateRequest, reply: FastifyReply) => {
  const { context, apiKey, clientRoute } = await lensedWrite(request, (context, apiKey) =>
    modelWithCreatePolicy(context, apiKey),
  );
  return reply
    .code(201)
    .send(await deliveryWritesService.createDeliveryEntry(context, apiKey, request.body, clientRoute));
};

export const updateDeliveryEntry = async (request: UpdateRequest) => {
  const { context, apiKey, clientRoute } = await lensedWrite(request, (context, apiKey) =>
    entryModelWithPolicy(context, apiKey, request.params.id, 'update'),
  );
  return deliveryWritesService.updateDeliveryEntry(
    context,
    apiKey,
    request.params.id,
    request.body,
    clientRoute,
  );
};

export const deleteDeliveryEntry = async (
  request: FastifyRequest<{ Params: EntryParams }>,
  reply: FastifyReply,
) => {
  const { context, apiKey, clientRoute } = await lensedWrite(request, (context, apiKey) =>
    entryModelWithPolicy(context, apiKey, request.params.id, 'delete'),
  );
  await deliveryWritesService.deleteDeliveryEntry(context, apiKey, request.params.id, clientRoute);
  return reply.code(204).send();
};
