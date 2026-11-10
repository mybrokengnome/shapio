/**
 * The schema version this site was built against, passed to the Shapio client as `schemaVersion`.
 * `npm run types` rewrites this file from the SCHEMA_VERSION in src/lib/shapio.generated.ts; undefined
 * (before the first run, or against Shapio before 0.9.0) reads today's schema.
 */
export const SCHEMA_VERSION: string | undefined = undefined;
