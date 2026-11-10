import { isInterfaceDefinition, isModelDefinition, routeKeyOf, type DefinitionLens } from '@shapio/schema';
import { schemaVersionToken } from '../constants/schemaLens.js';
import { parseQueryTree, type QueryTree, type QueryValue } from '../content/compiler/querystring.js';
import { rewriteQueryTree } from '../content/lens/query.js';
import { apiKeyOfRoute, modelNotFound, modelRouteOf } from '../content/model.js';
import { AppError } from '../helpers/appError.js';
import type { ContentAction } from '../permissions/types.js';
import { lensUncovered, schemaVersionUnavailable } from '../schema/errors.js';
import type { LensBudgetKey } from '../schema/lens/budget.js';
import type { RequestLens } from '../schema/lens/views.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import {
  activeLens,
  loadSchemaLens,
  namesSchemaVersion,
  type ContentServiceContext,
} from './contentAccess.js';

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
 * The route a request names in the client's version, resolved before anything is authorized (plan
 * schema-lenses): only names, never a lens (no `LENS_UNCOVERED`, no `SCHEMA_VERSION_UNAVAILABLE`), and it never
 * throws, so a caller that may not read learns nothing a request without a version would not tell it.
 */
export type ClientRoute = {
  /** The route key the request sent (the client's version's). */
  clientRouteKey: string;
  /** The definition it names in the client's version; null when that version has no such route. */
  definitionId: string | null;
  /** Today's API ID and route key of that definition; null when it is gone since (or unknown). */
  apiKey: string | null;
  routeKey: string | null;
};

/** The client's route in today's names; null without an active lens (the request is today's already). */
export const clientRouteOf = (context: ContentServiceContext, routeKey: string): ClientRoute | null => {
  const lens = activeLens(context);
  if (!lens) {
    return null;
  }
  const model = lens.view.modelsByRouteKey.get(routeKey)?.definition;
  const contract = lens.view.interfacesByRouteKey.get(routeKey)?.definition;
  const id =
    model && isModelDefinition(model)
      ? model.id
      : contract && isInterfaceDefinition(contract)
        ? contract.id
        : null;
  const today = id === null ? undefined : context.snapshot.byId.get(id)?.definition;
  const current =
    today && isModelDefinition(today)
      ? { apiKey: today.apiKey, routeKey: modelRouteOf(context.snapshot, today).key }
      : today && isInterfaceDefinition(today)
        ? { apiKey: today.apiKey, routeKey: routeKeyOf(today) }
        : { apiKey: null, routeKey: null };
  return { clientRouteKey: routeKey, definitionId: id, ...current };
};

const isRefusal = (error: unknown) =>
  error instanceof AppError && (error.statusCode === 401 || error.statusCode === 403);

/**
 * Authorizes a request that names a schema version exactly as the same request without one would be: a caller
 * refused for the client's model gets the answer today's resolution of the same route key gives it (404 for an
 * unknown key, its 401/403 otherwise), and a model gone since is a 404 only once the caller is authorized for
 * what the key names today. `authorize` is the service's own check by today's API ID (it throws when refused).
 */
export const authorizeClientRoute = async <T>(
  context: ContentServiceContext,
  route: ClientRoute | null,
  apiKey: string,
  authorize: (apiKey: string) => Promise<T>,
): Promise<T> => {
  if (!route) {
    return authorize(apiKey);
  }
  const asWithoutVersion = async () => authorize(apiKeyOfRoute(context.snapshot, route.clientRouteKey));
  if (route.apiKey === null) {
    await asWithoutVersion();
    throw modelNotFound(route.clientRouteKey);
  }
  try {
    return await authorize(route.apiKey);
  } catch (error) {
    if (!isRefusal(error)) {
      throw error;
    }
    await asWithoutVersion();
    // Authorized for what the key names today, refused for what it named then: the refusal names only the
    // route key the caller sent, never an API ID it did not send.
    throw renamedRefusal(error as AppError, route.apiKey, route.clientRouteKey);
  }
};

const renamedRefusal = (error: AppError, apiKey: string, routeKey: string): AppError =>
  new AppError(
    error.statusCode,
    error.code,
    error.message.split(`"${apiKey}"`).join(`"${routeKey}"`),
    error.details,
    { cause: error },
  );

/**
 * The gate every call naming a schema version passes before anything lens-specific happens (no lens loaded, no
 * build budget charged, no version error): authorized for what the route key it sent names today, exactly as
 * without a version; for a key today's schema does not know (a route renamed since), the caller must hold some
 * grant on the workspace (`holdsAnyGrant`), else it gets the 404 a request without a version gets.
 */
export const authorizeBeforeLens = async (
  context: ContentServiceContext,
  routeKey: string,
  authorize: (apiKey: string) => Promise<unknown>,
  holdsAnyGrant: () => Promise<boolean>,
): Promise<void> => {
  let todayKey: string | null = null;
  try {
    todayKey = apiKeyOfRoute(context.snapshot, routeKey);
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== 404) {
      throw error;
    }
  }
  if (todayKey !== null) {
    await authorize(todayKey);
  } else if (!(await holdsAnyGrant())) {
    throw modelNotFound(routeKey);
  }
};

/**
 * The client's route once its lens is loaded: `409 SCHEMA_VERSION_UNAVAILABLE` for a route the version names
 * but cannot serve (history that does not reach it), never a 404 that hides it. Call after authorization.
 */
export const clientRouteAfterAuthorization = async (
  context: ContentServiceContext,
  routeKey: string,
  /** Whether the caller may act on a definition today (by its ID), before anything about it is answered. */
  accessible: (definitionId: string) => Promise<boolean>,
): Promise<ClientRoute | null> => {
  const route = clientRouteOf(context, routeKey);
  const lens = activeLens(context);
  const pruned = lens && route && route.definitionId === null ? lens.unavailable?.get(routeKey) : undefined;
  if (pruned) {
    // Only a caller that may act on that definition today learns it exists and why it cannot be served.
    if (!(await accessible(pruned.definitionId))) {
      throw modelNotFound(routeKey);
    }
    throw schemaVersionUnavailable(pruned.apiKey, pruned.oldestVersion);
  }
  return route;
};

/**
 * The lensed query of an authorized request on definition `definitionId`, in today's names, and the context with
 * its `fields=` selection: 409 `LENS_UNCOVERED` when the definition switched between a collection and a
 * singleton, 409 `SCHEMA_VERSION_UNAVAILABLE` when its history does not reach the version, 400
 * `LENS_QUERY_UNSUPPORTED` for a filter or sort the lens cannot run. Call only after authorization.
 */
export const lensQueryOf = (
  context: ContentServiceContext,
  definitionId: string,
  clientRouteKey: string,
  rawQuery: string,
  /**
   * What the caller may name (`lensQueryVisibility`): fields it reads as null, and fields whose fate since the
   * version it may learn. Absent (an interface's route): nothing gone or changed since is named.
   */
  visibility: { readsNull: (fieldId: string) => boolean; mayName: (fieldId: string) => boolean } = {
    readsNull: () => false,
    mayName: () => false,
  },
): { context: ContentServiceContext; rawQuery: string } => {
  const lens = activeLens(context);
  if (!lens) {
    return { context, rawQuery };
  }
  const definitionLens = routeLens(lens, definitionId, clientRouteKey);
  if (definitionLens.status === 'identity' && rawQuery === '') {
    return { context, rawQuery };
  }
  const rewritten = rewriteQueryTree(definitionLens, parseQueryTree(rawQuery), {
    lensFor: lens.lensFor,
    kindApiKey: (apiKey) => {
      const kindId = lens.view.modelsByApiKey.get(apiKey)?.definition.id;
      return kindId === undefined ? undefined : context.snapshot.byId.get(kindId)?.definition.apiKey;
    },
    readsNull: visibility.readsNull,
    mayName: visibility.mayName,
  });
  // A selection names the route model's field IDs; an interface's contract fields are each member's own
  // there (`queryMembers` maps them), so an interface read selects through its rewritten query alone.
  const clientDefinition = lens.view.byId.get(definitionId)?.definition;
  const contract = clientDefinition !== undefined && isInterfaceDefinition(clientDefinition);
  return {
    context: { ...context, lensSelection: contract ? null : rewritten.selectedFieldIds },
    rawQuery: serializeQueryTree(rewritten.tree),
  };
};

/**
 * A request's route key and querystring in today's names, in one step and before authorization (GraphQL's
 * root reads, which authorize per field afterwards). REST, preview and in-process reads use `clientRouteOf`,
 * `authorizeClientRoute` and `lensQueryOf` instead, so nothing lens-specific answers a caller that may not read.
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
  routeLens(lens, id, routeKey);
  const current = currentRouteKey(context.snapshot, id, routeKey);
  return { ...lensQueryOf(context, id, routeKey, rawQuery), routeKey: current };
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

/** Today's API IDs → the client's, for a definition and the relation targets one populate level below it. */
const clientNamesOf = (lens: RequestLens, definitionId: string): Map<string, string> => {
  const names = new Map<string, string>();
  const add = (definition: DefinitionLens | null) => {
    if (!definition || definition.storedApiKey === null) {
      return;
    }
    names.set(definition.storedApiKey, definition.apiKey);
    for (const field of definition.fields) {
      if (field.kind !== 'null' && !names.has(field.stored.apiKey)) {
        names.set(field.stored.apiKey, field.apiKey);
      }
    }
  };
  const route = lens.lensFor(definitionId);
  add(route);
  for (const field of route?.fields ?? []) {
    if (field.kind !== 'null' && field.client.type === 'relation') {
      try {
        add(lens.lensFor(field.client.settings.target));
      } catch {
        // A target whose history does not reach the version: its names stay today's.
      }
    }
  }
  return names;
};

const QUOTED = /"([^"]*)"/g;
const NAMED_DETAILS = ['field', 'apiKey', 'modelKey'] as const;

/**
 * A query error in the client's names: the parser and compiler run on the rewritten (today's) query, so the
 * API IDs they quote, and those in `details`, are mapped back by stable ID. Anything else is left as it is.
 */
const inClientNames = (names: ReadonlyMap<string, string>, error: AppError): AppError => {
  const rename = (key: string) => names.get(key) ?? key;
  const details =
    typeof error.details === 'object' && error.details !== null
      ? Object.fromEntries(
          Object.entries(error.details as Record<string, unknown>).map(([key, value]) => [
            key,
            (NAMED_DETAILS as readonly string[]).includes(key) && typeof value === 'string'
              ? rename(value)
              : value,
          ]),
        )
      : error.details;
  return new AppError(
    error.statusCode,
    error.code,
    error.message.replace(QUOTED, (_match, key: string) => `"${rename(key)}"`),
    details,
    { cause: error },
  );
};

/**
 * Parses (or otherwise checks) a lensed query so its errors name the client's fields and models: wrap the
 * parse of a request `lensDeliveryRequest` rewrote. Without an active lens it only runs `parse`.
 */
export const withClientQueryNames = <T>(
  context: ContentServiceContext,
  definitionId: string,
  parse: () => T,
): T => {
  const lens = activeLens(context);
  if (!lens) {
    return parse();
  }
  try {
    return parse();
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode >= 500) {
      throw error;
    }
    throw inClientNames(clientNamesOf(lens, definitionId), error);
  }
};

/**
 * A call on the route key a request sent, ready for the service: without a schema version, today's API ID. With
 * one, the caller is authorized first exactly as without it (`authorizeBeforeLens`); only then is a version
 * error answered, the lens loaded (and its build budget charged), and the client's route resolved.
 */
export const openClientRoute = async (
  base: ContentServiceContext,
  routeKey: string,
  versionError: AppError | null,
  authorize: (apiKey: string) => Promise<unknown>,
  holdsAnyGrant: () => Promise<boolean>,
  /** The action the call performs: a definition the caller may not perform it on stays a plain 404. */
  actions: readonly ContentAction[],
  budgetKey?: LensBudgetKey | null,
): Promise<{ context: ContentServiceContext; apiKey: string; clientRoute: ClientRoute | null }> => {
  if (!versionError && !namesSchemaVersion(base)) {
    return { context: base, apiKey: apiKeyOfRoute(base.snapshot, routeKey), clientRoute: null };
  }
  await authorizeBeforeLens(base, routeKey, authorize, holdsAnyGrant);
  if (versionError) {
    throw versionError;
  }
  const context = await loadSchemaLens(base, budgetKey);
  const clientRoute = await clientRouteAfterAuthorization(context, routeKey, async (definitionId) => {
    for (const action of actions) {
      if ((await context.permissions.evaluate(context.actor, { action, modelId: definitionId })).allowed) {
        return true;
      }
    }
    return false;
  });
  const apiKey = clientRoute ? (clientRoute.apiKey ?? routeKey) : apiKeyOfRoute(context.snapshot, routeKey);
  return { context, apiKey, clientRoute };
};
