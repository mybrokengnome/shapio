/**
 * User content values: JSONB keyed by stable field IDs. The shape is only known at runtime from the active
 * model schema, so it is validated by Shapio's validator, never by a per-model TypeScript type.
 */
export type ContentData = Record<string, unknown>;
