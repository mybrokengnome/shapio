import { sql, type RawBuilder } from 'kysely';
import { toDatetimeText } from '../../../db/mysql/codec.js';
import { fieldIndexColumnName } from '../../../db/mysql/fieldIndexColumns.js';
import { CONTENT_HEADS_COLUMNS, CONTENT_HEADS_TABLE } from '../heads.js';
import type { ContentSqlDialect, FieldIndexDefinition, ListElement, ValueCast } from './types.js';

/**
 * MySQL content SQL (ADR 0001, "MySQL"). `data` is a JSON column; there is no containment index and no
 * partial index, so:
 * - each filterable or sortable field gets an invisible virtual column holding its value expression and one
 *   index `(site_id, model_id[, locale], state, column)`, built online (`ALGORITHM=INPLACE, LOCK=NONE`; a
 *   functional index cannot be). Queries use the expression; MySQL matches it to the column for `=`, ranges
 *   and ORDER BY (it does not for `<=>`, so equality is `expr = ? and expr is not null`: false, never null,
 *   for a missing value, as containment is);
 * - values are read with `json_value`, which gives SQL NULL for JSON null (`->>` gives the text 'null');
 *   text indexes and compares the first 255 characters (an index key is bounded), and equality with a longer
 *   value also compares the whole text; numbers compare as DOUBLE, decimal and biginteger strings as
 *   DECIMAL(65,30) (parameters are cast the same way, or MySQL does not use the column);
 * - text compares in the session's binary `utf8mb4_0900_bin` collation (case-sensitive, code point order),
 *   matched with `locate`, so no LIKE escaping; `$containsi` and search fold both sides with `lower()`;
 * - list membership is `member of` (unindexed); bound lists are `in (?, …)`;
 * - JSON functions return `utf8mb4_bin` text, which MySQL refuses to compare with a literal in the session's
 *   collation, so JSON is compared as JSON (`= cast('null' as json)`) or the literal's collation is named;
 * - NULL placement in sorts is written out: `(expr is null), expr`.
 */
const DATA = sql.ref(CONTENT_HEADS_COLUMNS.data);

/** Longest text `json_value` returns; longer values read as NULL. */
const TEXT_LIMIT = 1_000_000;
/** Characters of a text value that are indexed, compared in ranges and sorted. */
export const INDEXED_TEXT_LENGTH = 255;

/**
 * The JSON path of a field. The `_utf8mb4` introducer gives the literal the character set's own collation
 * whatever the session's: MySQL stores a generated column's expression that way, and only matches a query's
 * expression to the column (to use its index) when every literal in it has the same collation.
 */
const path = (fieldId: string) => sql`_utf8mb4${sql.lit(`$."${fieldId}"`)}`;

const fieldJson = (fieldId: string): RawBuilder<unknown> => sql`json_extract(${DATA}, ${path(fieldId)})`;
const fieldText = (fieldId: string): RawBuilder<unknown> =>
  sql`json_value(${DATA}, ${path(fieldId)} returning char(${sql.lit(TEXT_LIMIT)}))`;

/** decimal and biginteger: exact to 35 integer and 30 fractional digits; other numbers are doubles. */
const DECIMAL = sql`decimal(65,30)`;

const fieldValue = (fieldId: string, cast: ValueCast, numericString = false): RawBuilder<unknown> => {
  switch (cast) {
    case 'numeric':
      return numericString
        ? sql`json_value(${DATA}, ${path(fieldId)} returning ${DECIMAL})`
        : sql`json_value(${DATA}, ${path(fieldId)} returning double)`;
    case 'boolean':
      return sql`json_value(${DATA}, ${path(fieldId)} returning char(5))`;
    default:
      return sql`left(${fieldText(fieldId)}, ${sql.lit(INDEXED_TEXT_LENGTH)})`;
  }
};

const booleanText = (value: unknown) => (value === true || value === 'true' ? 'true' : 'false');

const castParameter = (value: unknown, cast: ValueCast, numericString = false): RawBuilder<unknown> => {
  switch (cast) {
    case 'numeric':
      return numericString ? sql`cast(${value} as ${DECIMAL})` : sql`cast(${value} as double)`;
    case 'boolean':
      return sql`${booleanText(value)}`;
    default:
      return sql`${value}`;
  }
};

const listValue = (value: string, element: ListElement): string =>
  element === 'timestamp' ? toDatetimeText(value) : value;

/** `expr = ? and expr is not null`: false (not null) for a missing value, and still index-served. */
const presentAndEqual = (expression: RawBuilder<unknown>, value: RawBuilder<unknown>) =>
  sql`(${expression} = ${value} and ${expression} is not null)`;

const textEquals = (fieldId: string, value: unknown): RawBuilder<unknown> => {
  const prefix = fieldValue(fieldId, 'text');
  if (typeof value === 'string' && [...value].length < INDEXED_TEXT_LENGTH) {
    return presentAndEqual(prefix, sql`${value}`);
  }
  return sql`(${prefix} = left(${value}, ${sql.lit(INDEXED_TEXT_LENGTH)}) and ${fieldText(fieldId)} = ${value})`;
};

const COLUMN_TYPES: Readonly<Record<ValueCast, RawBuilder<unknown>>> = {
  text: sql`varchar(${sql.lit(INDEXED_TEXT_LENGTH)}) collate utf8mb4_0900_bin`,
  numeric: sql`double`,
  boolean: sql`varchar(5) collate utf8mb4_0900_bin`,
};

const addIndexColumn = ({
  name,
  table,
  expression,
  cast,
  numericString,
}: FieldIndexDefinition): RawBuilder<unknown> =>
  sql`alter table ${sql.table(table)} add column ${sql.id(fieldIndexColumnName(name))} ${numericString ? DECIMAL : COLUMN_TYPES[cast]}
    generated always as (${expression}) virtual invisible, algorithm=inplace, lock=none`;

export const mysqlContentDialect: ContentSqlDialect = {
  name: 'mysql',

  uuid: (value) => sql`${value}`,
  timestamp: (value) => sql`${toDatetimeText(value)}`,
  bool: (value) => (value ? sql`true` : sql`false`),
  oneOf: (column, values, element) =>
    values.length === 0
      ? sql<boolean>`false`
      : sql<boolean>`${column} in (${sql.join(values.map((value) => listValue(value, element)))})`,

  fieldValue,
  fieldText,
  fieldJson,
  castParameter,

  fieldEquals: (target, value) => {
    if (target.list) {
      // `is not null` first: false, not null, for a missing list (so `$nin` includes it, as on PostgreSQL).
      const json = fieldJson(target.fieldId);
      return sql`(${json} is not null and json_type(${json}) = 'ARRAY' collate utf8mb4_bin and ${value} member of (${json}))`;
    }
    if (target.numericString && target.cast) {
      // Numeric like PostgreSQL ("12.5" equals "12.50"), as DECIMAL(65,30).
      return sql`(${fieldValue(target.fieldId, target.cast, true)} = ${castParameter(value, target.cast, true)})`;
    }
    if (target.cast === null || target.cast === 'text') {
      return target.cast === null
        ? presentAndEqual(fieldText(target.fieldId), sql`${value}`)
        : textEquals(target.fieldId, value);
    }
    return presentAndEqual(fieldValue(target.fieldId, target.cast), castParameter(value, target.cast));
  },
  fieldMissing: (fieldId) => {
    const json = fieldJson(fieldId);
    return sql`(${json} is null or ${json} = cast('null' as json) or ${json} = cast('""' as json) or ${json} = json_array())`;
  },
  textMatch: (fieldId, operator, text) => {
    const value = fieldText(fieldId);
    switch (operator) {
      case '$startsWith':
        return sql`(locate(${text}, ${value}) = 1)`;
      case '$endsWith':
        return sql`(right(${value}, ${sql.lit([...text].length)}) = ${text})`;
      case '$notContains':
        return sql`(locate(${text}, coalesce(${value}, '')) = 0)`;
      default:
        return sql`(locate(${text}, ${value}) > 0)`;
    }
  },
  containsInsensitive: (fieldId, text) => sql`(locate(lower(${text}), lower(${fieldText(fieldId)})) > 0)`,

  localeRank: (chain, column) =>
    sql`(case ${column} ${sql.join(
      chain.map((locale, index) => sql`when ${locale} then ${sql.lit(index)}`),
      sql` `,
    )} end)`,
  sortDirection: (direction) => (direction === 'desc' ? sql`desc` : sql`asc`),
  sortTerm: (expression, direction, nullable) => {
    const order = direction === 'desc' ? sql`desc` : sql`asc`;
    // PostgreSQL's default: nulls sort as the largest value. MySQL sorts them as the smallest.
    return nullable
      ? sql`(${expression} is null) ${order}, ${expression} ${order}`
      : sql`${expression} ${order}`;
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

  fieldIndexColumn: {
    add: addIndexColumn,
    drop: (name) =>
      sql`alter table ${sql.table(CONTENT_HEADS_TABLE)} drop column ${sql.id(fieldIndexColumnName(name))}, algorithm=inplace, lock=none`,
  },
  createFieldIndex: ({ name, table, localized, modelIdColumn }) => {
    const { siteId, locale, state } = CONTENT_HEADS_COLUMNS;
    const leading = localized
      ? sql`${sql.ref(siteId)}, ${sql.ref(modelIdColumn)}, ${sql.ref(locale)}, ${sql.ref(state)}`
      : sql`${sql.ref(siteId)}, ${sql.ref(modelIdColumn)}, ${sql.ref(state)}`;
    return sql`create index ${sql.id(name)} on ${sql.table(table)} (${leading}, ${sql.id(fieldIndexColumnName(name))}) algorithm=inplace lock=none`;
  },
  createFieldStatistics: () => null,
  dropFieldIndex: (name) =>
    sql`drop index ${sql.id(name)} on ${sql.table(CONTENT_HEADS_TABLE)} algorithm=inplace lock=none`,
  dropFieldStatistics: () => null,
  analyze: (table) => sql`analyze table ${sql.table(table)}`,
};
