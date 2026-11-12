import type { Kysely } from 'kysely';

/**
 * MySQL twin of `../20261112120000_entry_heads_scalars_gin.ts`: MySQL has no containment index (ADR 0001), so there
 * is nothing to change.
 */
export const up = async (_db: Kysely<unknown>): Promise<void> => {};

export const down = async (_db: Kysely<unknown>): Promise<void> => {};
