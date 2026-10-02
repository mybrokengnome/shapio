/**
 * Stable IDs for models, components and fields: random UUIDs (v4).
 *
 * Why UUID rather than ULID: PostgreSQL stores and indexes `uuid` natively (16 bytes) for the system
 * tables that key on model IDs; `crypto.randomUUID()` exists in Node and every browser, so the admin can
 * create field IDs client-side with no dependency; and nothing in Shapio needs IDs to sort by creation time
 * (revisions carry their own version numbers and timestamps). IDs are compared case-insensitively nowhere:
 * they are always lower-case as generated.
 */
export const STABLE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isStableId = (value: unknown): value is string =>
  typeof value === 'string' && STABLE_ID_PATTERN.test(value);

export const createStableId = (): string => globalThis.crypto.randomUUID();
