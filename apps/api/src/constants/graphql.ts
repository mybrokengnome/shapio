/** `/api/graphql` runtime limits (ADR 0006). */

/** Parsed-and-validated documents kept per GraphQL schema (least recently used dropped first). */
export const GRAPHQL_DOCUMENT_CACHE_SIZE = 500;

/** A site's GraphQL schema is dropped from memory when no request has used it for this long. */
export const GRAPHQL_SITE_SCHEMA_IDLE_MS = 10 * 60 * 1000;

/** `/api/graphql/playground?query=`: the longest operation the page opens with (it travels in the URL). */
export const PLAYGROUND_QUERY_MAX_LENGTH = 8192;

/** `/api/graphql/playground?theme=`: GraphiQL's two themes. */
export const PLAYGROUND_THEMES = ['light', 'dark'] as const;
