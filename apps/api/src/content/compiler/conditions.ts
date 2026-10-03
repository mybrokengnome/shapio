import { sql, type RawBuilder } from 'kysely';

/**
 * Conditions on the head query's entry (alias `h`, compile.ts) for `HeadQueryPlan.conditions`, so callers
 * outside the compiler never write SQL against its aliases.
 */

/** The head belongs to entry `id`. */
export const entryIdIs = (id: string): RawBuilder<boolean> => sql<boolean>`h.entry_id = ${id}::uuid`;

/** The head belongs to one of `ids` (one bound array, whatever its length). */
export const entryIdIn = (ids: readonly string[]): RawBuilder<boolean> =>
  sql<boolean>`h.entry_id = any(${[...ids]}::uuid[])`;
