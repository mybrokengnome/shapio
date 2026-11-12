import { isDeliveryRead, pathHasQueryParameter, withQueryParameter } from './site.js';

/**
 * Schema versions (server 0.9.0 or later). A client names the schema version it was built against, the
 * `SCHEMA_VERSION` token `shapio types generate` writes (`<schemaId>:<version>`, opaque to the client), and
 * every read answers in that version's shape, even after the schema has moved on.
 */

/** The request header that names the client's schema version (every request except delivery reads). */
export const SCHEMA_VERSION_HEADER = 'shapio-schema-version';

/** The query parameter that names the client's schema version on delivery reads. */
export const SCHEMA_VERSION_QUERY_PARAMETER = 'schemaVersion';

/** The response header every delivery response carries: the instance's current schema version token. */
export const SCHEMA_VERSION_CURRENT_HEADER = 'shapio-schema-version-current';

/**
 * Where a request names the client's schema version, next to the workspace (site.ts). Delivery GETs put it in
 * the query string, so URL-keyed CDN and data caches keep the versions apart (they ignore `Vary`); every other
 * request sends the `Shapio-Schema-Version` header. A path that already carries `schemaVersion=` is left as
 * it is.
 */
const namesSchemaVersion = (path: string) => pathHasQueryParameter(path, [SCHEMA_VERSION_QUERY_PARAMETER]);

/**
 * A delivery read path with the client's schema version as its query parameter, unless the path already
 * carries one. For transports that only take delivery reads (`createDeliveryClient`), which send no headers.
 */
export const withSchemaVersionQuery = (schemaVersion: string | undefined, path: string): string =>
  schemaVersion === undefined || namesSchemaVersion(path)
    ? path
    : withQueryParameter(path, SCHEMA_VERSION_QUERY_PARAMETER, schemaVersion);

/**
 * Where a request names the client's schema version, next to the workspace (site.ts). Delivery GETs put it in
 * the query string, so URL-keyed CDN and data caches keep the versions apart (they ignore `Vary`); every other
 * request sends the `Shapio-Schema-Version` header. A path that already carries `schemaVersion=` is left as
 * it is, and gets no header.
 */
export const applySchemaVersion = (
  schemaVersion: string | undefined,
  method: string,
  path: string,
): { path: string; headers: Record<string, string> } => {
  if (schemaVersion === undefined || namesSchemaVersion(path)) {
    return { path, headers: {} };
  }
  return isDeliveryRead(method, path)
    ? { path: withSchemaVersionQuery(schemaVersion, path), headers: {} }
    : { path, headers: { [SCHEMA_VERSION_HEADER]: schemaVersion } };
};

/** What a response read through a schema version says about it (`meta.schemaVersion`). */
export type SchemaVersionMeta = {
  /** The token the request named. */
  requested: string;
  /** The instance's current schema version token. */
  current: string;
};
