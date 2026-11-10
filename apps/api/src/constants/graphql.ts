/** `/api/graphql` runtime limits (ADR 0006). */

/** Parsed-and-validated documents kept per GraphQL schema (least recently used dropped first). */
export const GRAPHQL_DOCUMENT_CACHE_SIZE = 500;

/** A site's GraphQL schema is dropped from memory when no request has used it for this long. */
export const GRAPHQL_SITE_SCHEMA_IDLE_MS = 10 * 60 * 1000;

/**
 * GraphQL schemas kept at most, across sites and visibility sets (one per distinct set of masks delivery
 * callers hold, plus each site's full schema); the least recently used is dropped first. A 30-model schema
 * takes about 1.6 MB.
 */
export const GRAPHQL_SCHEMA_VARIANTS_MAX = 32;

/**
 * Lens schemas kept (plan schema-lenses): one per (workspace, visibility, client version's revisions), least
 * recently used dropped first. Apart from the current schemas: they never evict one, never count against
 * GRAPHQL_SCHEMA_VARIANTS_MAX, and a client walking versions can hold no more than this many.
 */
export const GRAPHQL_LENS_SCHEMA_CACHE_SIZE = 8;

/** `/api/graphql/playground?query=`: the longest operation the page opens with (it travels in the URL). */
export const PLAYGROUND_QUERY_MAX_LENGTH = 8192;

/** `/api/graphql/playground?theme=`: GraphiQL's two themes. */
export const PLAYGROUND_THEMES = ['light', 'dark'] as const;
