import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DELIVERY_VARY, DRAFTS_CACHE_CONTROL } from '../constants/sites.js';
import { apiKeyOfRoute } from '../content/model.js';
import { AppError } from '../helpers/appError.js';
import { appendVary } from '../helpers/vary.js';
import type { ContentServiceContext } from '../services/contentAccess.js';
import * as contentDeliveryService from '../services/contentDelivery.js';
import { clientRouteOf } from '../services/contentDeliveryLens.js';
import { contentContextFor, rawQueryOf } from './contentContext.js';

/** `:modelKey` is the route key: the plural API ID of a collection, the API ID of a singleton. */
type ModelParams = { modelKey: string };
type EntryParams = ModelParams & { id: string };

const cacheControlOf = (request: FastifyRequest, noStore: boolean) => {
  if (noStore) {
    return DRAFTS_CACHE_CONTROL;
  }
  return request.principal.kind === 'anonymous'
    ? 'public, max-age=0, must-revalidate'
    : 'private, max-age=0, must-revalidate';
};

/**
 * Delivery responses are cacheable by validators: a strong ETag over the exact body (so it changes whenever
 * a head version, a populated target or the projection changes), `Vary` on the credentials that select the
 * principal, on the `Shapio-Site` header that selects the site (`?site=` is part of the URL) and on the
 * `Shapio-Schema-Version` header that selects the shape (`?schemaVersion=` likewise), and `private`
 * caching whenever a principal is authenticated (build plan §4.E6). `noStore`: draft reads, never stored.
 */
export const sendCacheable = (
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  { noStore = false }: { noStore?: boolean } = {},
) => {
  const body = JSON.stringify(payload);
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 32)}"`;
  reply.header('etag', etag);
  appendVary(reply, DELIVERY_VARY);
  reply.header('cache-control', cacheControlOf(request, noStore));
  const match = request.headers['if-none-match'];
  if (typeof match === 'string' && match.split(',').some((candidate) => candidate.trim() === etag)) {
    return reply.code(304).send();
  }
  return reply.type('application/json; charset=utf-8').send(body);
};

/** Field usage is counted after the response is sent, off its path (plan delivery-perf). */
const usageOptions = (request: FastifyRequest) => ({
  usage: request.server.usage,
  defer: (task: () => Promise<void>) => request.server.recordUsageAfterResponse(request.log, task),
});

/** A delivery response, never stored by a cache when it carries drafts. */
const sendDelivery = (
  request: FastifyRequest,
  reply: FastifyReply,
  result: contentDeliveryService.DeliveryList | contentDeliveryService.DeliveryItem,
) => sendCacheable(request, reply, result, { noStore: result.meta.publicationState === 'draft' });

/** Why a schema version cannot be served: answered only to a caller that is authorized without one. */
const VERSION_ERROR_CODES: ReadonlySet<string> = new Set([
  'SCHEMA_VERSION_INVALID',
  'SCHEMA_VERSION_FOREIGN',
  'SCHEMA_VERSION_AHEAD',
  'SCHEMA_VERSION_MISMATCH',
]);

const isVersionError = (error: unknown): error is AppError =>
  error instanceof AppError && VERSION_ERROR_CODES.has(error.code);

/**
 * The content context of a delivery, preview or write request, and the schema-version error it must answer
 * once the caller is authorized (plan schema-lenses): a version that cannot be read or served never answers
 * before authorization, so a caller that may not read gets exactly what it gets without a version. With an
 * error the context is today's (no lens).
 */
export const contextDeferringVersion = async (
  request: FastifyRequest,
): Promise<{ context: ContentServiceContext; versionError: AppError | null }> => {
  const versionError = request.schemaVersionError;
  if (versionError) {
    request.schemaVersionToken = null;
    return { context: await contentContextFor(request), versionError };
  }
  try {
    return { context: await contentContextFor(request), versionError: null };
  } catch (error) {
    if (!isVersionError(error)) {
      throw error;
    }
    // Kept on the request, so a second context of the same request (a write's `preValidation`) defers it too.
    request.schemaVersionError = error;
    request.schemaVersionToken = null;
    return { context: await contentContextFor(request), versionError: error };
  }
};

/**
 * The route a request reads: today's API ID, or through a schema lens the client's route (plan schema-lenses),
 * which the service authorizes as a request without a version before anything lens-specific runs.
 */
const routeOf = async (request: FastifyRequest<{ Params: ModelParams }>) => {
  const { context, versionError } = await contextDeferringVersion(request);
  if (versionError) {
    await contentDeliveryService.authorizeDeliveryRead(
      context,
      apiKeyOfRoute(context.snapshot, request.params.modelKey),
    );
    throw versionError;
  }
  const clientRoute = clientRouteOf(context, request.params.modelKey);
  const apiKey = clientRoute
    ? (clientRoute.apiKey ?? request.params.modelKey)
    : apiKeyOfRoute(context.snapshot, request.params.modelKey);
  return { context, apiKey, options: { ...usageOptions(request), clientRoute } };
};

export const listDelivery = async (request: FastifyRequest<{ Params: ModelParams }>, reply: FastifyReply) => {
  const { context, apiKey, options } = await routeOf(request);
  return sendDelivery(
    request,
    reply,
    await contentDeliveryService.listDelivery(context, apiKey, rawQueryOf(request), options),
  );
};

export const getDelivery = async (request: FastifyRequest<{ Params: EntryParams }>, reply: FastifyReply) => {
  const { context, apiKey, options } = await routeOf(request);
  return sendDelivery(
    request,
    reply,
    await contentDeliveryService.getDelivery(
      context,
      apiKey,
      request.params.id,
      rawQueryOf(request),
      options,
    ),
  );
};
