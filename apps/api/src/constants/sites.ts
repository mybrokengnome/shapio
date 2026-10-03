/** Sites (plan agentic-ecosystem §H, ADR 0011). */

/** The primary site the sites migration created; every row that existed before sites belongs to it. */
export const PRIMARY_SITE_ID = '00000000-0000-4000-b000-000000000001';

/** Admin API requests name their site with this header (the admin sends it on every request). */
export const SITE_HEADER = 'shapio-site';

/** Delivery requests may name their site with this query parameter (it must match a site token's site). */
export const SITE_QUERY_PARAMETER = 'site';
