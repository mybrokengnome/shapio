/** Sites (plan agentic-ecosystem §H, ADR 0011). */

/**
 * The ID of the built-in site (key `default`), which the sites migration created as the primary site; every
 * row that existed before sites belongs to it. It may later stop being primary, or be deleted, so it never
 * means "the primary site" (read the flag: `sitesRepository.findPrimary`). Its only runtime use is
 * `findPreSitesSite`: work queued before sites existed (a transfer import, an after-hook event) belongs here.
 */
export const PRIMARY_SITE_ID = '00000000-0000-4000-b000-000000000001';

/**
 * A workspace key: lower case, starts with a letter (the same rule as role keys). Used in URLs and
 * `?workspace=`.
 */
export const SITE_KEY_PATTERN = '^[a-z][a-z0-9-]{0,62}$';

/** Requests name their workspace with this header (the user-facing spelling since 0.8.2). */
export const WORKSPACE_HEADER = 'shapio-workspace';

/** The header's original spelling, accepted forever; the admin and `@shapio/client` still send it. */
export const SITE_HEADER = 'shapio-site';

/** Both header spellings, in the order they are read (the mismatch rule applies across them). */
export const SITE_HEADERS = [WORKSPACE_HEADER, SITE_HEADER] as const;

/** Delivery requests may name their workspace with this query parameter (it must match a token's workspace). */
export const WORKSPACE_QUERY_PARAMETER = 'workspace';

/** The query parameter's original spelling, accepted forever. */
export const SITE_QUERY_PARAMETER = 'site';

/**
 * Both query parameter spellings, in the order they are read. Site resolution consumes both, so neither ever
 * reaches a route's querystring schema or the content compiler.
 */
export const SITE_QUERY_PARAMETERS = [WORKSPACE_QUERY_PARAMETER, SITE_QUERY_PARAMETER] as const;

/**
 * `Vary` of cacheable delivery responses (REST and GraphQL GETs): the credentials that select the principal,
 * and both headers that select the workspace. CDNs that key on the URL only need `?workspace=` (or `?site=`)
 * instead of a header.
 */
export const DELIVERY_VARY = 'Authorization, Cookie, Shapio-Workspace, Shapio-Site';

/** `Cache-Control` of delivery responses carrying drafts (REST and GraphQL; plan drafts-mode): never stored. */
export const DRAFTS_CACHE_CONTROL = 'private, no-store';
