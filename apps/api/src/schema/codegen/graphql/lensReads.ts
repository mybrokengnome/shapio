import { isInterfaceDefinition, isModelDefinition, routeKeyOf, type SchemaDefinition } from '@shapio/schema';
import { apiKeyOfRoute, modelRouteOf } from '../../../content/model.js';
import { AppError } from '../../../helpers/appError.js';
import { activeLens, type ContentServiceContext } from '../../../services/contentAccess.js';
import { lensDeliveryRequest } from '../../../services/contentDeliveryLens.js';
import type { SchemaBuild } from './build.js';
import type { GraphqlContext } from './context.js';

/**
 * Root reads of a lens schema (plan schema-lenses). Its arguments are in the client's version (route, API IDs
 * in filters and sorts); they are rewritten into today's names with the same edge REST uses
 * (`lensDeliveryRequest`: `LENS_QUERY_UNSUPPORTED` for a filter or sort on a field gone or changed since,
 * `LENS_UNCOVERED` for a model that switched between a collection and a singleton), then read by the
 * unchanged delivery service, whose projection shapes rows back into the client's version.
 */
export type DeliveryCall = {
  /** The content service context (through a lens: with its `fields=` selection). */
  service: ContentServiceContext;
  /** Today's API ID of the route the client named. */
  apiKey: string;
  /** The querystring in today's names. */
  rawQuery: string;
};

/** A schema version was named on a mutation: lenses are for reads (plan schema-lenses, agreed 9). */
export const lensMutationsUnsupported = () =>
  new AppError(
    400,
    'LENS_MUTATIONS_UNSUPPORTED',
    'GraphQL mutations cannot name a schema version. Send mutations without the Shapio-Schema-Version header or ?schemaVersion=, in the current schema.',
  );

const isModelNotFound = (error: unknown) => error instanceof AppError && error.code === 'MODEL_NOT_FOUND';

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

/**
 * The delivery call of a root read of `owner` with `rawQuery` (built from the field's arguments). Without an
 * active lens, the call as it always was. Through one, in today's names; null when the definition is gone since
 * the client's version (its queries stay in the client's schema and read nothing).
 */
export const deliveryCall = async (
  build: SchemaBuild,
  context: GraphqlContext,
  owner: SchemaDefinition,
  rawQuery: string,
): Promise<DeliveryCall | null> => {
  const service = await context.content(build.snapshot);
  if (!build.lens || !activeLens(service)) {
    return { service, apiKey: owner.apiKey, rawQuery };
  }
  try {
    const lensed = lensDeliveryRequest(service, clientRouteKey(build, owner), rawQuery);
    return {
      service: lensed.context,
      apiKey: apiKeyOfRoute(lensed.context.snapshot, lensed.routeKey),
      rawQuery: lensed.rawQuery,
    };
  } catch (error) {
    if (isModelNotFound(error)) {
      return null;
    }
    throw error;
  }
};
