import { sql, type RawBuilder } from 'kysely';
import { CONTENT_HEADS_COLUMNS } from '../heads.js';
import { modelIdMatches } from './modelMatch.js';
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
 * equality on a field without an index is emitted as `filter_data @> {...}`; ranges, sorts and equality on
 * indexed fields (filterable or sortable) use per-field B-tree expression indexes built `CONCURRENTLY` with a
 * matching `CREATE STATISTICS` object.
 */
const DATA = sql.ref(CONTENT_HEADS_COLUMNS.data);

/**
 * `filter_data`: `shapio_scalar_fields(data)`, the top-level fields of `data` a containment can match (it drops
 * nulls, objects, and arrays without a scalar element: component items, their item IDs, rich text and JSON
 * objects). A trigger keeps it for every write (migration `20261112120000_entry_heads_scalars_gin`); the GIN
 * index `entry_heads_filter_data_gin` covers it.
 */
const FILTER_DATA = sql.ref(CONTENT_HEADS_COLUMNS.filterData);

/**
 * The longest top-level string (or string element of a top-level array) `filter_data` holds: `shapio_scalar_fields`
 * (migration `20261112120000_entry_heads_scalars_gin`) leaves out a string whose `length(text)` exceeds this.
 * `length` counts characters in the database's server encoding, except SQL_ASCII, where it counts bytes.
 */
export const FILTER_STRING_MAX_CHARS = 1000;

/**
 * Whether a query value may be a string `filter_data` leaves out, so `fieldEquals` matches it against `data` in
 * either form: its UTF-8 byte length exceeds `FILTER_STRING_MAX_CHARS`. That is never less than what
 * `length(text)` gives for the same string stored in any server encoding PostgreSQL supports:
 * - UTF8 and the other multi-byte server encodings (EUC_*, MULE_INTERNAL): `length` counts characters, and every
 *   character is at least one UTF-8 byte;
 * - single-byte encodings (LATIN1 to LATIN10, WIN*, ISO_8859_*, KOI8*): one byte per character, the same count;
 * - SQL_ASCII: `length` counts the stored bytes, which are the UTF-8 bytes the client sent.
 * So `length(s) <= byteLength(s)`: every string the function may drop is caught (some it keeps are matched
 * against `data` too, which answers the same rows, only without the smaller index).
 */
export const isLongFilterString = (value: unknown): boolean =>
  typeof value === 'string' &&
  // At most three UTF-8 bytes per UTF-16 code unit: a string this short is never long.
  value.length * 3 > FILTER_STRING_MAX_CHARS &&
  Buffer.byteLength(value, 'utf8') > FILTER_STRING_MAX_CHARS;

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

const fieldJson = (fieldId: string): RawBuilder<unknown> => sql`(${DATA} -> ${sql.lit(fieldId)})`;

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

type Containment = (document: Readonly<Record<string, unknown>>) => RawBuilder<unknown>;

/**
 * `<target> @> $1::jsonb`: the only form a GIN index serves. The document is a parameter, field IDs included,
 * so nothing from the request is ever spliced into the SQL text. Every document is `{fieldId: scalar}` or
 * `{fieldId: [scalar]}` (`fieldEquals`), which `data` and `shapio_scalar_fields(data)` contain alike.
 */
const containmentOn =
  (target: RawBuilder<unknown>): Containment =>
  (document) =>
    sql`(${target} @> ${JSON.stringify(document)}::jsonb)`;

/** Against `filter_data`, served by `entry_heads_filter_data_gin`. */
export const filterContainment: Containment = containmentOn(FILTER_DATA);

/** Against the whole `data`, served by `entry_heads_data_gin` (an upgraded instance until the switch). */
export const documentContainment: Containment = containmentOn(DATA);

/** Published revisions of a model (or a family) as of a publication sequence (`snapshotCte`, relation targets). */
// Revisions have no `filter_data`; their `data` stands in for it, which every containment the compiler emits
// answers the same as `shapio_scalar_fields(data)` (and costs nothing: no index serves a snapshot anyway).
const snapshotRows = ({ siteId, modelIds, seq }: Omit<SnapshotSource, 'name'>): RawBuilder<unknown> => sql`
    select pl.entry_id, pl.site_id, pl.model_id, pl.locale, 'published'::text as state, r.data,
      r.data as filter_data, 0 as version,
      r.id as revision_id, pl.published_at as updated_at, null::timestamptz as autosaved_at,
      en.created_at as entry_created_at
    from publication_log pl
    join content_revisions r on r.id = pl.revision_id
    join entries en on en.id = pl.entry_id
    where pl.site_id = ${siteId}::uuid and ${modelIdMatches(sql`pl.model_id`, modelIds)}
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

const postgresDialectWith = (containment: Containment): ContentSqlDialect => ({
  name: 'postgres',

  uuid: (value) => sql`${value}::uuid`,
  timestamp: (value) => sql`${value}::timestamptz`,
  bool: (value) => sql`${value}::boolean`,
  oneOf: (column, values, element) => sql<boolean>`${column} = any(${[...values]}::${ARRAY_TYPES[element]})`,

  fieldValue,
  fieldText,
  fieldJson,
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
    const document = { [target.fieldId]: target.list ? [value] : value };
    // `filter_data` leaves long strings out: such a value is matched against the whole document in either form.
    return isLongFilterString(value) ? documentContainment(document) : containment(document);
  },
  fieldMissing: (fieldId) => {
    const json = fieldJson(fieldId);
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
});

/** PostgreSQL content SQL, containment against `filter_data` (but long strings against `data`). */
export const postgresContentDialect: ContentSqlDialect = postgresDialectWith(filterContainment);

/**
 * The same, with containment against the whole `data` (`db/contentIndexForm.ts`): what an upgraded instance
 * runs until `filter_data` is proved complete and indexed. Every query answers exactly as with `postgresContentDialect`.
 */
export const postgresDocumentContainmentDialect: ContentSqlDialect = postgresDialectWith(documentContainment);
