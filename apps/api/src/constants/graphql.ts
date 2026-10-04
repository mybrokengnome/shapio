/** `/api/graphql` runtime limits (ADR 0006). */

/** Parsed-and-validated documents kept per GraphQL schema (least recently used dropped first). */
export const GRAPHQL_DOCUMENT_CACHE_SIZE = 500;

/** A site's GraphQL schema is dropped from memory when no request has used it for this long. */
export const GRAPHQL_SITE_SCHEMA_IDLE_MS = 10 * 60 * 1000;
