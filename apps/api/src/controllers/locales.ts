import type { FastifyReply, FastifyRequest } from 'fastify';
import * as localesService from '../services/locales.js';
import { schemaContextFor } from './schemaContext.js';

type CodeParams = { code: string };
type CreateRequest = FastifyRequest<{ Body: { code: string; label: string; fallbacks?: string[] } }>;
type UpdateRequest = FastifyRequest<{ Params: CodeParams; Body: { label: string; fallbacks?: string[] } }>;
type DefaultRequest = FastifyRequest<{ Params: CodeParams; Body: { acknowledgeBreaking?: boolean } }>;
type DeleteRequest = FastifyRequest<{
  Params: CodeParams;
  Querystring: { acknowledgeDestructive?: boolean };
}>;

export const listLocales = async (request: FastifyRequest) => ({
  items: [...(await localesService.listLocales(await schemaContextFor(request)))],
});

export const createLocale = async (request: CreateRequest, reply: FastifyReply) =>
  reply.code(201).send(await localesService.createLocale(await schemaContextFor(request), request.body));

export const updateLocale = async (request: UpdateRequest) =>
  localesService.updateLocale(await schemaContextFor(request), request.params.code, request.body);

export const setDefaultLocale = async (request: DefaultRequest) =>
  localesService.setDefaultLocale(
    await schemaContextFor(request),
    request.params.code,
    request.body.acknowledgeBreaking ?? false,
  );

export const deleteLocale = async (request: DeleteRequest) =>
  localesService.deleteLocale(
    await schemaContextFor(request),
    request.params.code,
    request.query.acknowledgeDestructive ?? false,
  );
