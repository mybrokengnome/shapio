import { isInterfaceDefinition, isModelDefinition, routeKeyOf, type DefinitionLens } from '@shapio/schema';
import { schemaVersionToken } from '../constants/schemaLens.js';
import { parseQueryTree, type QueryTree, type QueryValue } from '../content/compiler/querystring.js';
import { rewriteQueryTree } from '../content/lens/query.js';
import { modelNotFound, modelRouteOf } from '../content/model.js';
import { lensUncovered } from '../schema/errors.js';
import type { RequestLens } from '../schema/lens/views.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import { activeLens, type ContentServiceContext } from './contentAccess.js';

/**
 * Schema lenses at the request's edge (plan schema-lenses): a delivery or preview request written in the
 * client's schema version (its route keys and API IDs) becomes one in today's, so the unchanged services,
 * parser and compiler serve it from today's storage. The response is shaped back by the projection
 * (`content/read.ts`, through the context's lens).
 */
export type LensedRequest = {
  /** The context, with the lensed `fields=` selection. */
  context: ContentServiceContext;
  /** Today's route key of the definition the client's route key named. */
  routeKey: string;
  /** The querystring in today's API IDs. */
  rawQuery: string;
};

/** A querystring tree back to bracket syntax (`parseQueryTree` reads it as the same tree). */
export const serializeQueryTree = (tree: QueryTree): string => {
  const params = new URLSearchParams();
  const append = (key: string, value: QueryValue) => {
    if (typeof value === 'string') {
      params.append(key, value);
    } else if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else {
      for (const [child, nested] of Object.entries(value)) {
        append(`${key}[${child}]`, nested);
      }
    }
  };
  for (const [key, value] of Object.entries(tree)) {
    append(key, value);
  }
  return params.toString();
};

/** The definition a client route key names in its version: a model's route, else an interface's. */
const clientDefinitionId = (view: SchemaSnapshot, routeKey: string): string => {
  const model = view.modelsByRouteKey.get(routeKey);
  if (model && isModelDefinition(model.definition)) {
    return model.definition.id;
  }
  const contract = view.interfacesByRouteKey.get(routeKey);
  if (contract && isInterfaceDefinition(contract.definition)) {
    return contract.definition.id;
  }
  throw modelNotFound(routeKey);
};

/** Today's route key of a definition; 404 when it is gone. */
const currentRouteKey = (current: SchemaSnapshot, id: string, clientRouteKey: string): string => {
  const definition = current.byId.get(id)?.definition;
  if (definition && isModelDefinition(definition)) {
    return modelRouteOf(current, definition).key;
  }
  if (definition && isInterfaceDefinition(definition)) {
    return routeKeyOf(definition);
  }
  throw modelNotFound(clientRouteKey);
};

/**
 * The lens of the definition a route reads: 404 when the definition is gone since the client's version, 409
 * `LENS_UNCOVERED` when it switched between a collection and a singleton, 409 `SCHEMA_VERSION_UNAVAILABLE`
 * when its history does not reach the version.
 */
const routeLens = (lens: RequestLens, id: string, routeKey: string): DefinitionLens => {
  const definitionLens = lens.lensFor(id);
  if (!definitionLens || definitionLens.status === 'gone') {
    throw modelNotFound(routeKey);
  }
  if (definitionLens.status === 'uncovered') {
    throw lensUncovered(routeKey);
  }
  return definitionLens;
};

/**
 * A delivery or preview request's route key and querystring in today's names. Without a lens (no version, the
 * current one, or nothing in the workspace changed since) the request passes through as it is.
 */
export const lensDeliveryRequest = (
  context: ContentServiceContext,
  routeKey: string,
  rawQuery: string,
): LensedRequest => {
  const lens = activeLens(context);
  if (!lens) {
    return { context, routeKey, rawQuery };
  }
  const id = clientDefinitionId(lens.view, routeKey);
  const definitionLens = routeLens(lens, id, routeKey);
  const current = currentRouteKey(context.snapshot, id, routeKey);
  if (definitionLens.status === 'identity' && rawQuery === '') {
    return { context, routeKey: current, rawQuery };
  }
  const rewritten = rewriteQueryTree(definitionLens, parseQueryTree(rawQuery), {
    lensFor: lens.lensFor,
    kindApiKey: (apiKey) => {
      const kindId = lens.view.modelsByApiKey.get(apiKey)?.definition.id;
      return kindId === undefined ? undefined : context.snapshot.byId.get(kindId)?.definition.apiKey;
    },
  });
  // A selection names the route model's field IDs; an interface's contract fields are each member's own
  // there (`queryMembers` maps them), so an interface read selects through its rewritten query alone.
  const clientDefinition = lens.view.byId.get(id)?.definition;
  const contract = clientDefinition !== undefined && isInterfaceDefinition(clientDefinition);
  return {
    context: { ...context, lensSelection: contract ? null : rewritten.selectedFieldIds },
    routeKey: current,
    rawQuery: serializeQueryTree(rewritten.tree),
  };
};

/** `meta.schemaVersion` of a read naming a schema version: both versions as `<schemaId>:<version>` tokens. */
export type SchemaVersionMeta = { schemaVersion?: { requested: string; current: string } };

export const schemaVersionMetaOf = (context: ContentServiceContext): SchemaVersionMeta =>
  context.lens && context.schemaId !== undefined
    ? {
        schemaVersion: {
          requested: schemaVersionToken(context.schemaId, context.lens.requested),
          current: schemaVersionToken(context.schemaId, context.lens.current),
        },
      }
    : {};

/** Whether a model or interface is known to the client's version (kinds and members added since are not). */
export const knownToLens = (context: ContentServiceContext, id: string): boolean => {
  const lens = activeLens(context);
  return !lens || lens.view.byId.has(id);
};
