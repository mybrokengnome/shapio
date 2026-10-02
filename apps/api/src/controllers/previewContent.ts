import type { FastifyReply, FastifyRequest } from 'fastify';
import * as previewContentService from '../services/previewContent.js';
import { contentContextFor, rawQueryOf } from './contentContext.js';

type ModelParams = { modelKey: string };
type EntryParams = ModelParams & { id: string };

const BEARER = /^Bearer\s+(\S+)$/i;

const tokenOf = (request: FastifyRequest) => BEARER.exec(request.headers.authorization ?? '')?.[1];

/** Draft content must never be cached by browsers or shared caches. */
const send = (reply: FastifyReply, payload: unknown) =>
  reply
    .header('cache-control', 'private, no-store')
    .header('vary', 'Authorization')
    .type('application/json; charset=utf-8')
    .send(JSON.stringify(payload));

export const listPreview = async (request: FastifyRequest<{ Params: ModelParams }>, reply: FastifyReply) =>
  send(
    reply,
    await previewContentService.listPreview(
      request.server.publishing,
      await contentContextFor(request),
      request.server.schemaLookup,
      { token: tokenOf(request), modelKey: request.params.modelKey, rawQuery: rawQueryOf(request) },
    ),
  );

export const getPreview = async (request: FastifyRequest<{ Params: EntryParams }>, reply: FastifyReply) =>
  send(
    reply,
    await previewContentService.getPreview(
      request.server.publishing,
      await contentContextFor(request),
      request.server.schemaLookup,
      {
        token: tokenOf(request),
        modelKey: request.params.modelKey,
        id: request.params.id,
        rawQuery: rawQueryOf(request),
      },
    ),
  );
