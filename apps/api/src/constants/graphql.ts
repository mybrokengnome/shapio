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
 * Lens schemas (plan schema-lenses), cached per workspace, then per caller visibility TODAY (which does not
 * change with the version a request names), then per version's look (`lensSchemaKey`) in a segmented LRU:
 * this many entries on probation (built once) and this many protected (read again). A caller walking
 * versions churns only its own visibility's cache in its own workspace; nothing it does evicts another
 * workspace's lens schemas, and within a workspace another visibility's cache only as one of the
 * GRAPHQL_LENS_SPACES_PER_WORKSPACE least recently used. Never counted against GRAPHQL_SCHEMA_VARIANTS_MAX;
 * current-version schemas are never displaced.
 */
export const GRAPHQL_LENS_SCHEMAS_PROBATION = 2;
export const GRAPHQL_LENS_SCHEMAS_PROTECTED = 4;

/**
 * Visibility caches kept per workspace (least recently used dropped whole). Visibilities come from roles, so a
 * caller cannot mint new ones by naming versions.
 */
export const GRAPHQL_LENS_SPACES_PER_WORKSPACE = 4;

/**
 * Workspaces with lens schemas kept per process (least recently used dropped whole). At most
 * 16 × 4 × (2 + 4) = 384 lens schemas in the worst case; real use is far below.
 */
export const GRAPHQL_LENS_WORKSPACES_MAX = 16;

/** `/api/graphql/playground?query=`: the longest operation the page opens with (it travels in the URL). */
export const PLAYGROUND_QUERY_MAX_LENGTH = 8192;

/** `/api/graphql/playground?theme=`: GraphiQL's two themes. */
export const PLAYGROUND_THEMES = ['light', 'dark'] as const;
