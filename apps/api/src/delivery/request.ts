import { createClient, ShapioApiError, type RequestFn, type RequestOptions } from '@shapio/client';
import { Value } from 'typebox/value';
import { SITE_QUERY_PARAMETER } from '../constants/sites.js';
import { apiKeyOfRoute } from '../content/model.js';
import { AppError } from '../helpers/appError.js';
import type { ErrorLike } from '../helpers/errorResponse.js';
import { withoutSiteParameter } from '../helpers/siteQuery.js';
import { SnapshotChangesQuerySchema, type SnapshotChangesQuery } from '../routes/snapshots/schemas.js';
import type { ContentServiceContext } from '../services/contentAccess.js';
import { getDelivery, listDelivery } from '../services/contentDelivery.js';
import { getDeliverySite } from '../services/siteSeo.js';
import { currentSnapshot, listSnapshotChanges } from '../services/snapshotChanges.js';
import { ShapioVersionSkewError, toShapioApiError } from './errors.js';
import type { DeliveryRuntime } from './runtime.js';
import { openCallScope, type CallCredentials } from './scope.js';

/**
 * The delivery API as a `RequestFn` (`@shapio/client`'s transport): the client's delivery, site and snapshot
 * groups call it with the same paths they send over HTTP, and it answers them in process, with the same
 * bodies, and errors as the same `ShapioApiError`. Paths:
 *
 * - `GET /api/content/:routeKey` (a collection's page, or a singleton's entry)
 * - `GET /api/content/:routeKey/:id`
 * - `GET /api/site`
 * - `GET /api/snapshots/current`
 * - `GET /api/snapshots/changes`
 *
 * Anything else (writes, previews, the admin API, GraphQL) is 404 `NOT_AVAILABLE_IN_PROCESS`.
 */
export type DeliveryRoute =
  | { kind: 'list'; routeKey: string }
  | { kind: 'item'; routeKey: string; id: string }
  | { kind: 'site' }
  | { kind: 'snapshotCurrent' }
  | { kind: 'snapshotChanges' };

/** A matched path: the route, its querystring without `site`, and the site the path names, if any. */
export type MatchedRequest = { route: DeliveryRoute; query: string; site: string | undefined };

const decodeSegment = (segment: string): string | undefined => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
};

const routeOf = (segments: readonly string[]): DeliveryRoute | undefined => {
  const [api, group, first, second, ...rest] = segments;
  if (api !== 'api' || rest.length > 0) {
    return undefined;
  }
  if (group === 'content' && first) {
    const routeKey = decodeSegment(first);
    if (routeKey === undefined) {
      return undefined;
    }
    if (second === undefined) {
      return { kind: 'list', routeKey };
    }
    const id = decodeSegment(second);
    return id ? { kind: 'item', routeKey, id } : undefined;
  }
  if (group === 'site' && first === undefined) {
    return { kind: 'site' };
  }
  if (group === 'snapshots' && second === undefined) {
    if (first === 'current') {
      return { kind: 'snapshotCurrent' };
    }
    if (first === 'changes') {
      return { kind: 'snapshotChanges' };
    }
  }
  return undefined;
};

/** Matches a delivery read; undefined for any other method or path. */
export const matchDeliveryRequest = (method: string, path: string): MatchedRequest | undefined => {
  if (method.toUpperCase() !== 'GET') {
    return undefined;
  }
  const index = path.indexOf('?');
  const pathname = index === -1 ? path : path.slice(0, index);
  const rawQuery = index === -1 ? '' : path.slice(index + 1);
  if (!pathname.startsWith('/')) {
    return undefined;
  }
  const route = routeOf(pathname.slice(1).split('/'));
  if (!route) {
    return undefined;
  }
  // An empty `?site=` names no site, as over HTTP.
  const site = new URLSearchParams(rawQuery).get(SITE_QUERY_PARAMETER) || undefined;
  return { route, query: withoutSiteParameter(rawQuery), site };
};

const notAvailable = (method: string, path: string) =>
  new ShapioApiError(404, {
    error: {
      code: 'NOT_AVAILABLE_IN_PROCESS',
      message: `${method.toUpperCase()} ${path.split('?')[0] ?? path} is not available in process; only delivery reads are`,
    },
  });

/** The site a call reads: the path's `?site=` or the credentials' site; both must agree. */
const siteOf = (pathSite: string | undefined, credentialsSite: string | undefined): string | undefined => {
  if (pathSite !== undefined && credentialsSite !== undefined && pathSite !== credentialsSite) {
    throw new AppError(403, 'SITE_MISMATCH', 'The site option and ?site= name different sites');
  }
  return pathSite ?? credentialsSite;
};

/** `?from&to&after&limit`, coerced and checked against the HTTP route's own schema. */
const snapshotChangesQuery = (rawQuery: string): SnapshotChangesQuery => {
  const value = Value.Convert(SnapshotChangesQuerySchema, Object.fromEntries(new URLSearchParams(rawQuery)));
  if (Value.Check(SnapshotChangesQuerySchema, value)) {
    return value;
  }
  const validation = Value.Errors(SnapshotChangesQuerySchema, value).map(
    ({ instancePath, message, params }) => ({ instancePath, message, params }),
  );
  const [first] = validation;
  const failure: ErrorLike = Object.assign(
    new Error(`querystring${first?.instancePath ?? ''} ${first?.message ?? 'is invalid'}`),
    { statusCode: 400, validation },
  );
  throw failure;
};

/**
 * Values exactly as the HTTP API sends them: a JSON round trip, as the server serializes them. Dates become ISO
 * strings, `undefined` members disappear, and so do symbol-keyed members (a delivered rich-text value carries
 * its HTML renderer for GraphQL behind a symbol), so a caller gets plain data that holds nothing else.
 */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

const dispatch = async (
  context: ContentServiceContext,
  { route, query }: MatchedRequest,
): Promise<unknown> => {
  switch (route.kind) {
    case 'list':
      return listDelivery(context, apiKeyOfRoute(context.snapshot, route.routeKey), query);
    case 'item':
      return getDelivery(context, apiKeyOfRoute(context.snapshot, route.routeKey), route.id, query);
    case 'site':
      return getDeliverySite(context);
    case 'snapshotCurrent':
      return currentSnapshot(context);
    case 'snapshotChanges':
      return listSnapshotChanges(context, snapshotChangesQuery(query));
  }
};

/**
 * A `RequestFn` that answers delivery reads in this process, as `credentials` (a delivery token or none, and
 * a site). With `onVersionSkew: 'http'`, a call refused for a release mismatch is sent to the server instead.
 */
export const createInProcessRequest = (runtime: DeliveryRuntime, credentials: CallCredentials): RequestFn => {
  let fallback: RequestFn | undefined;
  let warnedSkew = false;
  const fallbackRequest = (): RequestFn | undefined => {
    if (runtime.onVersionSkew !== 'http' || runtime.fallbackUrl === undefined) {
      return undefined;
    }
    fallback ??= createClient({
      baseUrl: runtime.fallbackUrl,
      ...(credentials.token !== undefined ? { token: credentials.token } : {}),
      ...(credentials.site !== undefined ? { site: credentials.site } : {}),
    }).request;
    return fallback;
  };

  return async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    const method = options.method ?? 'GET';
    const matched = matchDeliveryRequest(method, path);
    if (!matched) {
      throw notAvailable(method, path);
    }
    try {
      const site = siteOf(matched.site, credentials.site);
      const context = await openCallScope(runtime, {
        ...(credentials.token !== undefined ? { token: credentials.token } : {}),
        ...(site !== undefined ? { site } : {}),
      });
      const result = asJson(await dispatch(context, matched)) as T;
      warnedSkew = false;
      return result;
    } catch (error) {
      const http = error instanceof ShapioVersionSkewError ? fallbackRequest() : undefined;
      if (http && error instanceof ShapioVersionSkewError) {
        if (!warnedSkew) {
          warnedSkew = true;
          runtime.log.warn(
            { serverRelease: error.serverRelease, libraryRelease: error.libraryRelease },
            'release mismatch; reading over HTTP until the releases match',
          );
        }
        return http<T>(path, options);
      }
      throw toShapioApiError(error, runtime.log);
    }
  };
};
