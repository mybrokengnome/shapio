import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRequestSchema } from '../plugins/schemaSnapshot.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import * as apiDocsService from '../services/apiDocs.js';

/** The view a contract renders: the current one, or the schema version the request names. */
const contractView = async (request: FastifyRequest) =>
  apiDocsService.contractViewFor(
    request.server.db,
    await getRequestSchema(request),
    request.schemaVersionToken,
  );

export const getOpenApi = async (request: FastifyRequest) =>
  apiDocsService.getOpenApiDocument((await contractView(request)).view, request.server.urls);

export const getDocsPage = async (request: FastifyRequest, reply: FastifyReply) =>
  reply
    .type('text/html; charset=utf-8')
    .send(
      apiDocsService.getDocsPage(
        await getRequestSchema(request),
        request.server.urls,
        request.server.config.graphql,
        getRequestSite(request).key,
      ),
    );

export const getTypeScript = async (request: FastifyRequest) => {
  const { view, schemaId } = await contractView(request);
  return apiDocsService.getTypeScript(view, request.server.urls, schemaId);
};
