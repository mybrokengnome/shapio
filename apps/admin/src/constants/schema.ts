/** How often the admin checks whether another session changed the schema (no SSE endpoint exists). */
export const SCHEMA_POLL_INTERVAL_MS = 5_000;

/** The status bar's schema version is refreshed at most this often (plus on focus); it never polls. */
export const SCHEMA_VERSION_STALE_MS = 60_000;

/** How often a running schema change (prerequisite jobs) is polled for its outcome. */
export const SCHEMA_CHANGE_POLL_INTERVAL_MS = 1_000;

/** Final states of a planned schema change. */
export const FINAL_CHANGE_STATUSES: ReadonlySet<string> = new Set(['activated', 'failed', 'cancelled']);
