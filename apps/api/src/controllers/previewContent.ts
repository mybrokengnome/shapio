import type { FastifyReply, FastifyRequest } from 'fastify';
import { appendVary } from '../helpers/vary.js';
import * as previewContentService from '../services/previewContent.js';
import { previewTokenSiteOf } from '../services/previewTokens.js';
import { rawQueryOf } from './contentContext.js';
import { contextDeferringVersion } from './delivery.js';

type ModelParams = { modelKey: string };
type EntryParams = ModelParams & { id: string };

const BEARER = /^Bearer\s+(\S+)$/i;

const tokenOf = (request: FastifyRequest) => BEARER.exec(request.headers.authorization ?? '')?.[1];

/** The preview routes' credential site (`config.siteCredential`): the presented preview token's site. */
export const previewSiteCredential = (request: FastifyRequest) =>
  previewTokenSiteOf(request.server.publishing, tokenOf(request));

/** Draft content must never be cached by browsers or shared caches. */
const send = (reply: FastifyReply, payload: unknown) => {
  appendVary(reply, 'Authorization, Shapio-Schema-Version');
  return reply
    .header('cache-control', 'private, no-store')
    .type('application/json; charset=utf-8')
    .send(JSON.stringify(payload));
};

/** The request in today's names when it names an older schema version (plan schema-lenses). */
const lensedRequest = async (request: FastifyRequest<{ Params: ModelParams }>) => {
  // Nothing about a schema version is read here: the service checks the preview token first.
  const { context, versionError } = await contextDeferringVersion(request);
  return { context, routeKey: request.params.modelKey, rawQuery: rawQueryOf(request), versionError };
};

export const listPreview = async (request: FastifyRequest<{ Params: ModelParams }>, reply: FastifyReply) => {
  const { context, routeKey, rawQuery, versionError } = await lensedRequest(request);
  return send(
    reply,
    await previewContentService.listPreview(request.server.publishing, context, request.server.schemaLookup, {
      token: tokenOf(request),
      modelKey: routeKey,
      rawQuery,
      versionError,
    }),
  );
};

export const getPreview = async (request: FastifyRequest<{ Params: EntryParams }>, reply: FastifyReply) => {
  const { context, routeKey, rawQuery, versionError } = await lensedRequest(request);
  return send(
    reply,
    await previewContentService.getPreview(request.server.publishing, context, request.server.schemaLookup, {
      token: tokenOf(request),
      modelKey: routeKey,
      id: request.params.id,
      rawQuery,
      versionError,
    }),
  );
};
