import { isInterfaceDefinition, isModelDefinition, routeKeyOf, type SchemaDefinition } from '@shapio/schema';
import { modelRouteOf } from '../../../content/model.js';
import { AppError } from '../../../helpers/appError.js';
import { activeLens, type ContentServiceContext } from '../../../services/contentAccess.js';
import { clientRouteOf, type ClientRoute } from '../../../services/contentDeliveryLens.js';
import type { SchemaBuild } from './build.js';
import type { GraphqlContext } from './context.js';

/**
 * Root fields of a lens schema (plan schema-lenses). Their route and arguments are in the client's version;
 * they go to the delivery services with the client's route (`clientRouteOf`: names only, never a lens error),
 * which authorize the caller exactly as a request without a version first, and only then do the lens work:
 * `LENS_UNCOVERED`, `SCHEMA_VERSION_UNAVAILABLE`, the arguments' rewrite (`LENS_QUERY_UNSUPPORTED`) and, for
 * writes, the body's translation. A caller that may not read or write a model learns nothing a request without
 * a version would not tell it. The projection shapes rows back into the client's version.
 */
export type DeliveryCall = {
  /** The content service context. */
  service: ContentServiceContext;
  /** The API ID the services resolve: today's, or through a lens the one the client's route has today. */
  apiKey: string;
  /** The client's route through an active lens, for the services' two-step flow; null without one. */
  clientRoute: ClientRoute | null;
};

/** The route key the client's version gave a model or an interface definition. */
const clientRouteKey = (build: SchemaBuild, owner: SchemaDefinition): string => {
  if (isModelDefinition(owner)) {
    return modelRouteOf(build.snapshot, owner).key;
  }
  if (isInterfaceDefinition(owner)) {
    return routeKeyOf(owner);
  }
  return owner.apiKey;
};

/** The service call of a root field of `owner`. Without an active lens, the call as it always was. */
export const deliveryCall = async (
  build: SchemaBuild,
  context: GraphqlContext,
  owner: SchemaDefinition,
): Promise<DeliveryCall> => {
  const service = await context.content(build.snapshot);
  if (!build.lens || !activeLens(service)) {
    return { service, apiKey: owner.apiKey, clientRoute: null };
  }
  const named = clientRouteOf(service, clientRouteKey(build, owner));
  // GraphQL names a type, not a route: without a version the same field would be today's field of the same
  // definition, so a refused caller is answered by today's route (`authorizeClientRoute` falls back to the
  // route key it is given). A definition gone since keeps the client's key (admin lens schemas only).
  const clientRoute = named && named.routeKey !== null ? { ...named, clientRouteKey: named.routeKey } : named;
  return {
    service,
    apiKey: clientRoute?.apiKey ?? clientRoute?.clientRouteKey ?? owner.apiKey,
    clientRoute,
  };
};

/**
 * A read of a definition deleted since the client's version (admin lens schemas only), refused once the
 * caller was authorized: it reads as empty, so a query naming it stays valid.
 */
export const isGoneRead = (call: DeliveryCall, error: unknown): boolean =>
  call.clientRoute !== null &&
  call.clientRoute.apiKey === null &&
  error instanceof AppError &&
  error.code === 'MODEL_NOT_FOUND';
