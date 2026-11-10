/**
 * Schema lenses (plan schema-lenses): how a client names the schema version it was built against. Delivery
 * reads take the query parameter (CDNs key on the URL and ignore `Vary`), every other request the header.
 */
export const SCHEMA_VERSION_QUERY_PARAMETER = 'schemaVersion';

/** The request header (lower case, as Node exposes it); docs spell it `Shapio-Schema-Version`. */
export const SCHEMA_VERSION_HEADER = 'shapio-schema-version';

/** On every delivery response: `<schemaId>:<version>` of the schema the instance serves now. */
export const SCHEMA_VERSION_CURRENT_HEADER = 'Shapio-Schema-Version-Current';

/**
 * The API routes (below the API prefix) that read a schema version: delivery, preview, snapshots and the
 * generated contracts. Elsewhere the parameter and header mean nothing and are left alone.
 */
export const SCHEMA_LENS_ROUTE_PREFIXES = ['content/', 'preview/', 'snapshots/', 'docs/', 'graphql'] as const;

/** `<schemaId>:<version>`, as `shapio types generate` writes `SCHEMA_VERSION`. */
export const schemaVersionToken = (schemaId: string, version: number): string => `${schemaId}:${version}`;
