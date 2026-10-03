import { sql, type RawBuilder } from 'kysely';
import { contentDialect } from './currentDialect.js';
import type { ContentSqlDialect } from './dialect/types.js';

/**
 * Conditions on the head query's entry (alias `h`, compile.ts) for `HeadQueryPlan.conditions`, so callers
 * outside the compiler never write SQL against its aliases.
 */

/** The head belongs to entry `id`. */
export const entryIdIs = (id: string, dialect: ContentSqlDialect = contentDialect()): RawBuilder<boolean> =>
  sql<boolean>`h.entry_id = ${dialect.uuid(id)}`;

/** The head belongs to one of `ids` (one bound parameter, whatever its length). */
export const entryIdIn = (
  ids: readonly string[],
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<boolean> => dialect.oneOf(sql`h.entry_id`, ids, 'uuid');
