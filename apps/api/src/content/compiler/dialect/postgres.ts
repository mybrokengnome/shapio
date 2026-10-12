import { sql, type RawBuilder } from 'kysely';
import { CONTENT_HEADS_COLUMNS } from '../heads.js';
import type {
  ContentSqlDialect,
  ReferenceIds,
  SnapshotSource,
  ListElement,
  TextMatchOperator,
  ValueCast,
} from './types.js';

/**
 * PostgreSQL content SQL (ADR 0001): JSONB with a GIN `jsonb_path_ops` index serving containment, so
 * equality on a field without an index is emitted as `data @> {...}`; ranges, sorts and equality on indexed
 * fields (filterable or sortable) use per-field B-tree expression indexes built `CONCURRENTLY` with a
 * matching `CREATE STATISTICS` object.
 */
const DATA = sql.ref(CONTENT_HEADS_COLUMNS.data);

const ARRAY_TYPES: Readonly<Record<ListElement, RawBuilder<unknown>>> = {
  uuid: sql`uuid[]`,
  text: sql`text[]`,
  timestamp: sql`timestamptz[]`,
};

const MISSING_JSON = sql`('null'::jsonb, '""'::jsonb, '[]'::jsonb)`;

/** LIKE escaping (the default `\` escape character). */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

const likePattern = (operator: TextMatchOperator | '$containsi', text: string) => {
  const escaped = escapeLike(text);
  switch (operator) {
    case '$startsWith':
      return `${escaped}%`;
    case '$endsWith':
      return `%${escaped}`;
    default:
      return `%${escaped}%`;
  }
};

const fieldText = (fieldId: string): RawBuilder<unknown> => sql`(${DATA} ->> ${sql.lit(fieldId)})`;

const fieldValue = (fieldId: string, cast: ValueCast): RawBuilder<unknown> => {
  const text = fieldText(fieldId);
  switch (cast) {
    case 'numeric':
      return sql`(${text}::numeric)`;
    case 'boolean':
      return sql`(${text}::boolean)`;
    default:
      return text;
  }
};

const castParameter = (value: unknown, cast: ValueCast): RawBuilder<unknown> => {
  switch (cast) {
    case 'numeric':
      return sql`${value}::numeric`;
    case 'boolean':
      return sql`${value}::boolean`;
    default:
      return sql`${value}::text`;
  }
};

/**
 * `data @> $1::jsonb`: the only form the GIN index serves. The document is a parameter, field IDs included,
 * so nothing from the request is ever spliced into the SQL text.
 */
export const containment = (document: Readonly<Record<string, unknown>>): RawBuilder<unknown> =>
  sql`(${DATA} @> ${JSON.stringify(document)}::jsonb)`;

/** Published revisions of a model as of a publication sequence (`snapshotCte`, relation targets). */
const snapshotRows = ({ siteId, modelId, seq }: Omit<SnapshotSource, 'name'>): RawBuilder<unknown> => sql`
    select pl.entry_id, pl.site_id, pl.model_id, pl.locale, 'published'::text as state, r.data, 0 as version,
      r.id as revision_id, pl.published_at as updated_at, null::timestamptz as autosaved_at,
      en.created_at as entry_created_at
    from publication_log pl
    join content_revisions r on r.id = pl.revision_id
    join entries en on en.id = pl.entry_id
    where pl.site_id = ${siteId}::uuid and pl.model_id = ${modelId}
      and pl.from_seq <= ${seq}::bigint
      and (pl.to_seq is null or pl.to_seq > ${seq}::bigint)`;

/** A UUID-shaped text cast to uuid; anything else is no ID (a cast would fail the whole statement). */
const asUuid = (text: RawBuilder<unknown>): RawBuilder<unknown> =>
  sql`(case when ${text} ~ '^[0-9A-Fa-f-]{36}$' then (${text})::uuid end)`;

/** One row per stored ID: `jsonb_array_elements_text` for a list, a one-row select for a single ID. */
const referenceIds = (fieldId: string, list: boolean): ReferenceIds => {
  const json = sql`(${DATA} -> ${sql.lit(fieldId)})`;
  return list
    ? {
        from: sql`jsonb_array_elements_text(case when jsonb_typeof(${json}) = 'array' then ${json} end) as v(id)`,
        matches: (column) => sql`${column} = ${asUuid(sql`v.id`)}`,
      }
    : {
        from: sql`(select ${asUuid(sql`(case when jsonb_typeof(${json}) = 'string' then ${fieldText(fieldId)} end)`)} as id) v`,
        matches: (column) => sql`${column} = v.id`,
      };
};

export const postgresContentDialect: ContentSqlDialect = {
  name: 'postgres',

  uuid: (value) => sql`${value}::uuid`,
  timestamp: (value) => sql`${value}::timestamptz`,
  bool: (value) => sql`${value}::boolean`,
  oneOf: (column, values, element) => sql<boolean>`${column} = any(${[...values]}::${ARRAY_TYPES[element]})`,

  fieldValue,
  fieldText,
  fieldJson: (fieldId) => sql`(${DATA} -> ${sql.lit(fieldId)})`,
  castParameter,

  fieldEquals: (target, value) => {
    if (target.numericString && target.cast) {
      // "12.5" and "12.50" are equal numbers but different JSON strings: compare numerically.
      return sql`(${fieldValue(target.fieldId, target.cast)} = ${castParameter(value, target.cast)})`;
    }
    if (target.indexed && target.cast) {
      // The index expression (and its statistics) serve the filter; a GIN containment match must recheck,
      // and decompress, every candidate row. `is not null` keeps it false, never null, for a missing value,
      // like containment, so `$ne`/`$nin`/`$not` still include missing values (ADR 0001 amendment).
      const expression = fieldValue(target.fieldId, target.cast);
      return sql`(${expression} = ${castParameter(value, target.cast)} and ${expression} is not null)`;
    }
    return containment({ [target.fieldId]: target.list ? [value] : value });
  },
  fieldMissing: (fieldId) => {
    const json = postgresContentDialect.fieldJson(fieldId);
    return sql`(${json} is null or ${json} in ${MISSING_JSON})`;
  },
  textMatch: (fieldId, operator, text) =>
    operator === '$notContains'
      ? sql`(coalesce(${fieldText(fieldId)}, '') not like ${likePattern(operator, text)})`
      : sql`(${fieldText(fieldId)} like ${likePattern(operator, text)})`,
  containsInsensitive: (fieldId, text) =>
    sql`(${fieldText(fieldId)} ilike ${likePattern('$containsi', text)})`,

  localeRank: (chain, column) => sql`array_position(${[...chain]}::text[], ${column})`,
  sortDirection: (direction) => (direction === 'desc' ? sql`desc` : sql`asc`),
  snapshotCte: (source) => sql`with ${sql.id(source.name)} as (${snapshotRows(source)}
  ) `,
  snapshotRows,
  referenceIds,

  createFieldIndex: ({ name, table, leading, expression, modelIdColumn, modelId }) =>
    sql`create index concurrently if not exists ${sql.id(name)} on ${sql.table(table)} (${leading}, ${expression}) where ${sql.ref(modelIdColumn)} = ${modelId}`,
  createFieldStatistics: (name, expression, table) =>
    sql`create statistics if not exists ${sql.id(name)} on ${expression} from ${sql.table(table)}`,
  dropFieldIndex: (name) => sql`drop index concurrently if exists ${sql.id(name)}`,
  dropFieldStatistics: (name) => sql`drop statistics if exists ${sql.id(name)}`,
  analyze: (table) => sql`analyze ${sql.table(table)}`,
};
