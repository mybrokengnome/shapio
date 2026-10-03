import { sql, type RawBuilder } from 'kysely';
import { toStoredTimestamp } from '../../../db/sql/time.js';
import { CONTENT_HEADS_COLUMNS } from '../heads.js';
import type { ContentSqlDialect, ListElement, ValueCast } from './types.js';

/**
 * SQLite content SQL (ADR 0001, "D2: as built"). `data` is JSON text read with JSON1's `->`/`->>`; there is
 * no GIN index and no containment, so:
 * - one partial expression index per filterable or sortable field serves equality, ranges and sorts, and
 *   scalar equality is emitted on that same expression (`expr is ?`, which the planner treats like `=` and
 *   which is false, never null, for a missing value, as containment is);
 * - list membership is `json_each` (unindexed; the model's heads are scanned);
 * - LIKE folds ASCII case, so case-sensitive matches use `instr`/`substr`, and case-insensitive ones use
 *   `shapio_fold` (JavaScript `toLowerCase`, a deterministic function registered on every connection by
 *   the database layer) on the column and the same folding of the parameter in JavaScript;
 * - there are no `::` casts and no array parameters: lists are bound as one JSON text parameter, and
 *   timestamps as the stored text (`toStoredTimestamp`), which compares as time;
 * - indexes are built with a plain `CREATE INDEX` (no `CONCURRENTLY`: the build holds the single write lock
 *   until it finishes) and there is no `CREATE STATISTICS`.
 */
const DATA = sql.ref(CONTENT_HEADS_COLUMNS.data);

/** The name of the case-folding SQL function the database layer registers on each SQLite connection. */
export const FOLD_FUNCTION = 'shapio_fold';
/** What `shapio_fold` computes, for the parameter side (and the function's registration). */
export const foldText = (text: string): string => text.toLowerCase();

const listParameter = (values: readonly string[], element: ListElement): string =>
  JSON.stringify(element === 'timestamp' ? values.map((value) => toStoredTimestamp(value)) : [...values]);

const fieldText = (fieldId: string): RawBuilder<unknown> => sql`(${DATA} ->> ${sql.lit(fieldId)})`;
const fieldJson = (fieldId: string): RawBuilder<unknown> => sql`(${DATA} -> ${sql.lit(fieldId)})`;

/** Booleans extract as 1/0 and numbers as numbers; decimal and biginteger strings need the cast. */
const fieldValue = (fieldId: string, cast: ValueCast): RawBuilder<unknown> =>
  cast === 'numeric' ? sql`cast(${fieldText(fieldId)} as numeric)` : fieldText(fieldId);

const castParameter = (value: unknown, cast: ValueCast): RawBuilder<unknown> => {
  switch (cast) {
    case 'numeric':
      return sql`cast(${value} as numeric)`;
    case 'boolean':
      return sql`${value === true || value === 'true' ? 1 : 0}`;
    default:
      return sql`${value}`;
  }
};

export const sqliteContentDialect: ContentSqlDialect = {
  name: 'sqlite',

  uuid: (value) => sql`${value}`,
  timestamp: (value) => sql`${toStoredTimestamp(value)}`,
  bool: (value) => (value ? sql`true` : sql`false`),
  oneOf: (column, values, element) =>
    sql<boolean>`${column} in (select value from json_each(${listParameter(values, element)}))`,

  fieldValue,
  fieldText,
  fieldJson,
  castParameter,

  fieldEquals: (target, value) => {
    if (target.list) {
      const json = fieldJson(target.fieldId);
      return sql`(json_type(${json}) = 'array' and exists (select 1 from json_each(${json}) where value = ${value}))`;
    }
    if (target.numericString && target.cast) {
      // Numeric like PostgreSQL ("12.5" equals "12.50"); exact to about 15 significant digits.
      return sql`(${fieldValue(target.fieldId, target.cast)} = ${castParameter(value, target.cast)})`;
    }
    const expression = target.cast ? fieldValue(target.fieldId, target.cast) : fieldText(target.fieldId);
    return sql`(${expression} is ${castParameter(value, target.cast ?? 'text')})`;
  },
  fieldMissing: (fieldId) => {
    const json = fieldJson(fieldId);
    return sql`(${json} is null or ${json} in ('null', '""', '[]'))`;
  },
  textMatch: (fieldId, operator, text) => {
    const value = fieldText(fieldId);
    switch (operator) {
      case '$startsWith':
        return sql`(instr(${value}, ${text}) = 1)`;
      case '$endsWith':
        return sql`(substr(${value}, -length(${text})) = ${text})`;
      case '$notContains':
        return sql`(instr(coalesce(${value}, ''), ${text}) = 0)`;
      default:
        return sql`(instr(${value}, ${text}) > 0)`;
    }
  },
  containsInsensitive: (fieldId, text) =>
    sql`(instr(${sql.raw(FOLD_FUNCTION)}(${fieldText(fieldId)}), ${foldText(text)}) > 0)`,

  localeRank: (chain, column) =>
    sql`(case ${column} ${sql.join(
      chain.map((locale, index) => sql`when ${locale} then ${sql.lit(index)}`),
      sql` `,
    )} end)`,
  sortDirection: (direction, nullable) => {
    if (!nullable) {
      return direction === 'desc' ? sql`desc` : sql`asc`;
    }
    // PostgreSQL's default: nulls sort as the largest value.
    return direction === 'desc' ? sql`desc nulls first` : sql`asc nulls last`;
  },
  snapshotCte: ({ name, siteId, modelId, seq }) => sql`with ${sql.id(name)} as (
    select pl.entry_id, pl.site_id, pl.model_id, pl.locale, 'published' as state, r.data, 0 as version,
      r.id as revision_id, pl.published_at as updated_at, null as autosaved_at
    from publication_log pl
    join content_revisions r on r.id = pl.revision_id
    where pl.site_id = ${siteId} and pl.model_id = ${modelId}
      and pl.from_seq <= ${seq}
      and (pl.to_seq is null or pl.to_seq > ${seq})
  ) `,

  createFieldIndex: ({ name, table, leading, expression, modelIdColumn, modelId }) =>
    sql`create index if not exists ${sql.id(name)} on ${sql.table(table)} (${leading}, ${expression}) where ${sql.ref(modelIdColumn)} = ${modelId}`,
  createFieldStatistics: () => null,
  dropFieldIndex: (name) => sql`drop index if exists ${sql.id(name)}`,
  dropFieldStatistics: () => null,
  analyze: (table) => sql`analyze ${sql.table(table)}`,
};
