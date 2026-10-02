import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRequestSchema } from '../plugins/schemaSnapshot.js';
import * as apiDocsService from '../services/apiDocs.js';

export const getOpenApi = async (request: FastifyRequest) =>
  apiDocsService.getOpenApiDocument(await getRequestSchema(request), request.server.urls);

export const getDocsPage = async (request: FastifyRequest, reply: FastifyReply) =>
  reply
    .type('text/html; charset=utf-8')
    .send(
      apiDocsService.getDocsPage(
        await getRequestSchema(request),
        request.server.urls,
        request.server.config.graphql,
      ),
    );

export const getTypeScript = async (request: FastifyRequest) =>
  apiDocsService.getTypeScript(await getRequestSchema(request), request.server.urls);
