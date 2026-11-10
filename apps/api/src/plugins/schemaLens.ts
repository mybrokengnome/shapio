import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  SCHEMA_LENS_ROUTE_PATHS,
  SCHEMA_LENS_ROUTE_PREFIXES,
  SCHEMA_VERSION_CURRENT_HEADER,
  SCHEMA_VERSION_HEADER,
  SCHEMA_VERSION_QUERY_PARAMETER,
} from '../constants/schemaLens.js';
import { DELIVERY_VARY } from '../constants/sites.js';
import { AppError } from '../helpers/appError.js';
import { pickSchemaVersionToken, schemaVersionHeaderCandidate } from '../helpers/schemaVersionQuery.js';
import { appendVary } from '../helpers/vary.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** A delivery, preview, snapshot, contract or GraphQL request: one that may name a schema version. */
    schemaLensRoute: boolean;
    /** `<schemaId>:<version>` the request names (`?schemaVersion=` or the header); null when none. */
    schemaVersionToken: string | null;
    /**
     * The version could not be read (malformed, repeated, header and parameter disagreeing). Never answered
     * before the caller is authorized: a caller that may not read gets what it gets without a version.
     */
    schemaVersionError: AppError | null;
    /** Set when the request's content context is built: the current version's token, sent back as a header. */
    schemaVersionCurrent: string | null;
  }
}

type SchemaLensPluginOptions = {
  /** The API prefix (`/api/`, under the base path): lens routes are named below it. */
  apiPrefix: string;
};

const isPreviewPath = (path: string, apiPrefix: string) =>
  path.slice(apiPrefix.length).startsWith('preview/');

const pathOf = (request: FastifyRequest) => {
  const index = request.url.indexOf('?');
  return index === -1 ? request.url : request.url.slice(0, index);
};

/** Whether a request path (no querystring) is one that may name a schema version. */
export const isSchemaLensPath = (path: string, apiPrefix: string): boolean => {
  if (!path.startsWith(apiPrefix)) {
    return false;
  }
  const rest = path.slice(apiPrefix.length);
  return (
    (SCHEMA_LENS_ROUTE_PATHS as readonly string[]).includes(rest) ||
    SCHEMA_LENS_ROUTE_PREFIXES.some((prefix) => rest.startsWith(prefix))
  );
};

/**
 * Schema lenses (plan schema-lenses): reads the schema version a delivery, preview, snapshot, contract or
 * GraphQL request names, from `?schemaVersion=` or the `Shapio-Schema-Version` header, and removes the
 * parameter from the parsed query so a route's strict querystring schema never sees it. Building the lens is
 * the content context's work (`controllers/contentContext.ts`); this only reads. Responses of those requests
 * carry `Shapio-Schema-Version-Current` once the context named it.
 */
export const schemaLensPlugin = fp<SchemaLensPluginOptions>(
  async (app: FastifyInstance, { apiPrefix }) => {
    app.decorateRequest('schemaLensRoute', false);
    app.decorateRequest('schemaVersionToken', null);
    app.decorateRequest('schemaVersionError', null);
    app.decorateRequest('schemaVersionCurrent', null);
    app.addHook('onRequest', async (request) => {
      if (!isSchemaLensPath(pathOf(request), apiPrefix)) {
        return;
      }
      request.schemaLensRoute = true;
      const query = request.query as Record<string, unknown> | undefined;
      const candidates = [
        schemaVersionHeaderCandidate(request.headers[SCHEMA_VERSION_HEADER]),
        { source: `?${SCHEMA_VERSION_QUERY_PARAMETER}=`, value: query?.[SCHEMA_VERSION_QUERY_PARAMETER] },
      ];
      try {
        request.schemaVersionToken = pickSchemaVersionToken(candidates);
      } catch (error) {
        if (!(error instanceof AppError)) {
          throw error;
        }
        // Kept for after authorization; the first value sent stays the token, so a reader that does not look
        // at `schemaVersionError` still refuses a malformed one rather than reading today's shape.
        request.schemaVersionError = error;
        const sent = candidates
          .map(({ value }) => value)
          .find((value) => typeof value === 'string' && value !== '');
        request.schemaVersionToken = typeof sent === 'string' ? sent : null;
      }
      if (query && typeof query === 'object') {
        delete query[SCHEMA_VERSION_QUERY_PARAMETER];
      }
    });
    app.addHook('onSend', async (request, reply) => {
      if (request.schemaLensRoute) {
        // Every answer of a lensed route depends on the version, errors included: no cache may serve one
        // version's answer for another. Cacheable answers already name it in the documented order; anything
        // else gets that same order (previews, which vary on their token only, just the version).
        const vary = String(reply.getHeader('vary') ?? '').toLowerCase();
        if (!vary.includes(SCHEMA_VERSION_HEADER)) {
          appendVary(
            reply,
            isPreviewPath(pathOf(request), apiPrefix) ? 'Shapio-Schema-Version' : DELIVERY_VARY,
          );
        }
      }
      if (request.schemaVersionCurrent !== null) {
        reply.header(SCHEMA_VERSION_CURRENT_HEADER, request.schemaVersionCurrent);
      }
    });
  },
  { name: 'shapio-schema-lens' },
);
