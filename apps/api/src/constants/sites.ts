/** Sites (plan agentic-ecosystem §H, ADR 0011). */

/** The primary site the sites migration created; every row that existed before sites belongs to it. */
export const PRIMARY_SITE_ID = '00000000-0000-4000-b000-000000000001';

/** A site key: lower case, starts with a letter (the same rule as role keys). Used in URLs and `?site=`. */
export const SITE_KEY_PATTERN = '^[a-z][a-z0-9-]{0,62}$';

/** Admin API requests name their site with this header (the admin sends it on every request). */
export const SITE_HEADER = 'shapio-site';

/** Delivery requests may name their site with this query parameter (it must match a site token's site). */
export const SITE_QUERY_PARAMETER = 'site';

/**
 * `Vary` of cacheable delivery responses (REST and GraphQL GETs): the credentials that select the principal,
 * and the header that selects the site. CDNs that key on the URL only need `?site=` instead of the header.
 */
export const DELIVERY_VARY = 'Authorization, Cookie, Shapio-Site';

/** `Cache-Control` of delivery responses carrying drafts (REST and GraphQL; plan drafts-mode): never stored. */
export const DRAFTS_CACHE_CONTROL = 'private, no-store';
