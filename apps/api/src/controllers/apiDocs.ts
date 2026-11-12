import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRequestSchema } from '../plugins/schemaSnapshot.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import * as apiDocsService from '../services/apiDocs.js';
import { schemaVersionTokenWithPin } from '../services/contentAccess.js';

/**
 * The view a contract renders: the current one, or the schema version the request names (or, naming none,
 * the one its API token is pinned to).
 */
const contractView = async (request: FastifyRequest) => {
  // A version the request could not name (empty, repeated, header and parameter disagreeing): these routes run
  // after `requireAdmin`, so the caller is authorized by now.
  if (request.schemaVersionError) {
    throw request.schemaVersionError;
  }
  return apiDocsService.contractViewFor(
    request.server.db,
    await getRequestSchema(request),
    await schemaVersionTokenWithPin(request.server.db, request.principal, request.schemaVersionToken),
    request.principal,
  );
};

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
