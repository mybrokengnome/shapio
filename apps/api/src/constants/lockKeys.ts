/**
 * PostgreSQL advisory locks use two int4 keys: (namespace, key). Advisory locks are database-wide and shared
 * with any other application on the same database, so every Shapio lock lives under one of these namespaces.
 * Values are arbitrary but must never change once released: two Shapio versions must agree on them.
 */
export const LOCK_NAMESPACE = {
  /** Startup migrations. Key: MIGRATION_LOCK_KEY. */
  migrations: 0x5348_0001,
  /** Schema activation (exclusive) and entry writes (shared) per model. Key: hash of the model ID. */
  model: 0x5348_0002,
  /** First-admin setup. Key: SETUP_LOCK_KEY. */
  setup: 0x5348_0003,
  /** Field index builds and drops on entry_heads, one at a time. Key: INDEX_BUILD_LOCK_KEY. */
  indexBuilds: 0x5348_0004,
} as const;

export const MIGRATION_LOCK_KEY = 1;
export const SETUP_LOCK_KEY = 1;
export const INDEX_BUILD_LOCK_KEY = 1;
