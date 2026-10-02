import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { apiKeyOfRoute } from '../content/model.js';
import * as contentDeliveryService from '../services/contentDelivery.js';
import { contentContextFor, rawQueryOf } from './contentContext.js';

/** `:modelKey` is the route key: the plural API ID of a collection, the API ID of a singleton. */
type ModelParams = { modelKey: string };
type EntryParams = ModelParams & { id: string };

/**
 * Delivery responses are cacheable by validators: a strong ETag over the exact body (so it changes whenever
 * a head version, a populated target or the projection changes), `Vary` on the credentials that select the
 * principal, and `private` caching whenever a principal is authenticated (build plan §4.E6).
 */
const sendCacheable = (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
  const body = JSON.stringify(payload);
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 32)}"`;
  reply.header('etag', etag);
  reply.header('vary', 'Authorization, Cookie');
  reply.header(
    'cache-control',
    request.principal.kind === 'anonymous'
      ? 'public, max-age=0, must-revalidate'
      : 'private, max-age=0, must-revalidate',
  );
  const match = request.headers['if-none-match'];
  if (typeof match === 'string' && match.split(',').some((candidate) => candidate.trim() === etag)) {
    return reply.code(304).send();
  }
  return reply.type('application/json; charset=utf-8').send(body);
};

export const listDelivery = async (request: FastifyRequest<{ Params: ModelParams }>, reply: FastifyReply) => {
  const context = await contentContextFor(request);
  const apiKey = apiKeyOfRoute(context.snapshot, request.params.modelKey);
  return sendCacheable(
    request,
    reply,
    await contentDeliveryService.listDelivery(context, apiKey, rawQueryOf(request), {
      usage: request.server.usage,
    }),
  );
};

export const getDelivery = async (request: FastifyRequest<{ Params: EntryParams }>, reply: FastifyReply) => {
  const context = await contentContextFor(request);
  const apiKey = apiKeyOfRoute(context.snapshot, request.params.modelKey);
  return sendCacheable(
    request,
    reply,
    await contentDeliveryService.getDelivery(context, apiKey, request.params.id, rawQueryOf(request), {
      usage: request.server.usage,
    }),
  );
};
