import { createHash } from 'node:crypto';
import { isStableId, SCALAR_DATA_TYPES, type DataType } from '@shapio/schema';
import { sql, type RawBuilder } from 'kysely';

/**
 * The single source of SQL expressions over content values (ADR 0001). The query compiler (package E)
 * and the index builder (schema planner) both call these functions, so an expression index matches the
 * filter or sort that should use it byte for byte. Package E extends this module; never duplicate it.
 *
 * Rules (build plan §3.1):
 * - date, datetime and time are canonical UTC ISO-8601 text: compared and sorted as text, because
 *   timestamp casts are not IMMUTABLE and cannot be indexed;
 * - decimal and biginteger are JSON strings cast to numeric; number and integer are JSON numbers cast
 *   to numeric (text→numeric is IMMUTABLE, so it can be indexed);
 * - booleans cast to boolean; every other scalar is the raw text value.
 *
 * Field IDs are embedded as SQL literals, never parameters, because a parameterised expression cannot
 * match an index expression. That is safe only because field IDs come from the registry and are checked
 * to be UUIDs here; nothing from a request ever reaches these functions unvalidated.
 */

/** Content heads (package E). Expression indexes live on this table only. */
export const CONTENT_HEADS_TABLE = 'entry_heads';
/** Columns of `entry_heads` the index layout depends on. Package E must keep these names. */
export const CONTENT_HEADS_COLUMNS = {
  data: 'data',
  modelId: 'model_id',
  locale: 'locale',
  state: 'state',
} as const;

/** Bump when any expression below changes: index names change with it, so old indexes are rebuilt. */
export const EXPRESSION_VERSION = 1;

export type ValueCast = 'text' | 'numeric' | 'boolean';

const NUMERIC_TYPES: ReadonlySet<DataType> = new Set(['number', 'integer', 'decimal', 'biginteger']);

export const valueCastFor = (type: DataType): ValueCast => {
  if (NUMERIC_TYPES.has(type)) {
    return 'numeric';
  }
  return type === 'boolean' ? 'boolean' : 'text';
};

export class UnsafeIdentifierError extends Error {
  constructor(what: string) {
    super(`Refusing to build SQL with ${what}: not a stable ID`);
    this.name = 'UnsafeIdentifierError';
  }
}

const assertStableId = (value: string, what: string) => {
  if (!isStableId(value)) {
    throw new UnsafeIdentifierError(what);
  }
};

/**
 * The expression for one top-level scalar field of a head's `data`, e.g.
 * `((data ->> '0b1c…')::numeric)`. Throws for non-scalar types or a malformed field ID.
 */
export const fieldValueExpression = (fieldId: string, type: DataType): RawBuilder<unknown> => {
  assertStableId(fieldId, 'a field ID');
  if (!SCALAR_DATA_TYPES.has(type)) {
    throw new Error(`${type} fields have no scalar expression`);
  }
  const text = sql`(${sql.ref(CONTENT_HEADS_COLUMNS.data)} ->> ${sql.lit(fieldId)})`;
  switch (valueCastFor(type)) {
    case 'numeric':
      return sql`(${text}::numeric)`;
    case 'boolean':
      return sql`(${text}::boolean)`;
    default:
      return text;
  }
};

/** `data -> 'fieldId'`: the raw JSON value of a top-level field (any type). */
export const fieldJsonExpression = (fieldId: string): RawBuilder<unknown> => {
  assertStableId(fieldId, 'a field ID');
  return sql`(${sql.ref(CONTENT_HEADS_COLUMNS.data)} -> ${sql.lit(fieldId)})`;
};

/** `data ->> 'fieldId'`: a top-level field as text, uncast (LIKE/ILIKE filters). */
export const fieldTextExpression = (fieldId: string): RawBuilder<unknown> => {
  assertStableId(fieldId, 'a field ID');
  return sql`(${sql.ref(CONTENT_HEADS_COLUMNS.data)} ->> ${sql.lit(fieldId)})`;
};

/**
 * `data @> $1::jsonb`: the only form the GIN `jsonb_path_ops` index serves (ADR 0001). The document is a
 * parameter, field IDs included, so nothing from the request is ever spliced into the SQL text.
 */
export const containmentExpression = (document: Readonly<Record<string, unknown>>): RawBuilder<unknown> =>
  sql`(${sql.ref(CONTENT_HEADS_COLUMNS.data)} @> ${JSON.stringify(document)}::jsonb)`;

/**
 * The model ID as a SQL literal for `model_id = '…'`. Expression indexes are partial on the model, and
 * the planner can only prove a partial index's predicate against a literal, never a parameter.
 */
export const modelIdLiteral = (modelId: string): RawBuilder<unknown> => {
  assertStableId(modelId, 'a model ID');
  return sql.lit(modelId);
};

/** A comparison value cast the way `fieldValueExpression` casts the stored value, so indexes match. */
export const castParameter = (value: unknown, type: DataType): RawBuilder<unknown> => {
  switch (valueCastFor(type)) {
    case 'numeric':
      return sql`${value}::numeric`;
    case 'boolean':
      return sql`${value}::boolean`;
    default:
      return sql`${value}::text`;
  }
};

export type FieldIndexSpec = {
  modelId: string;
  fieldId: string;
  type: DataType;
  /**
   * Whether the model is localized. Localized models' queries always name a locale, so their indexes lead
   * with it; non-localized models' heads are read without a locale condition, so theirs omit it. Absent
   * means localized (the layout of indexes planned before this flag existed).
   */
  localized?: boolean;
};

/**
 * Deterministic index name: a hash of the model ID, field ID, value cast, column layout and expression
 * version, so the same field with the same expression and layout always maps to the same index, and a
 * changed one to a new one. 63 bytes is PostgreSQL's identifier limit; this is 3 + 32.
 */
export const fieldIndexName = ({ modelId, fieldId, type, localized = true }: FieldIndexSpec): string => {
  const layout = localized ? '' : ':shared';
  const digest = createHash('sha256')
    .update(`${modelId}:${fieldId}:${valueCastFor(type)}:v${EXPRESSION_VERSION}${layout}`)
    .digest('hex');
  return `eh_${digest.slice(0, 32)}`;
};

const INDEX_NAME_PATTERN = /^eh_([0-9a-f]{32})$/;

const assertIndexName = (indexName: string): string => {
  const match = INDEX_NAME_PATTERN.exec(indexName);
  if (!match) {
    throw new UnsafeIdentifierError('an index name');
  }
  return match[1] as string;
};

/**
 * The extended-statistics object that goes with a field index (same hash, `es_` prefix). PostgreSQL keeps
 * no expression statistics for *partial* indexes, so without it every range filter is estimated at a third
 * of the table and the planner ignores the field index.
 */
export const fieldStatisticsName = (indexName: string): string => `es_${assertIndexName(indexName)}`;

/**
 * `CREATE INDEX CONCURRENTLY` for a filterable/sortable field over the model's heads only: (locale, state,
 * value) for localized models, (state, value) otherwise. Must run outside a transaction.
 */
export const createFieldIndexStatement = (spec: FieldIndexSpec): RawBuilder<unknown> => {
  assertStableId(spec.modelId, 'a model ID');
  const { modelId, locale, state } = CONTENT_HEADS_COLUMNS;
  const leading =
    spec.localized === false ? sql`${sql.ref(state)}` : sql`${sql.ref(locale)}, ${sql.ref(state)}`;
  return sql`create index concurrently if not exists ${sql.id(fieldIndexName(spec))} on ${sql.table(CONTENT_HEADS_TABLE)} (${leading}, ${fieldValueExpression(spec.fieldId, spec.type)}) where ${sql.ref(modelId)} = ${sql.lit(spec.modelId)}`;
};

/** `CREATE STATISTICS` on the field's value expression (the same expression the index and queries use). */
export const createFieldStatisticsStatement = (spec: FieldIndexSpec): RawBuilder<unknown> =>
  sql`create statistics if not exists ${sql.id(fieldStatisticsName(fieldIndexName(spec)))} on ${fieldValueExpression(spec.fieldId, spec.type)} from ${sql.table(CONTENT_HEADS_TABLE)}`;

/** `DROP INDEX CONCURRENTLY IF EXISTS`; names only ever come from `fieldIndexName`. */
export const dropIndexStatement = (indexName: string): RawBuilder<unknown> => {
  assertIndexName(indexName);
  return sql`drop index concurrently if exists ${sql.id(indexName)}`;
};

/** Drops the statistics object of a field index (`fieldStatisticsName`). */
export const dropStatisticsStatement = (indexName: string): RawBuilder<unknown> =>
  sql`drop statistics if exists ${sql.id(fieldStatisticsName(indexName))}`;

/** Refreshes planner statistics of the heads table (after an index and its statistics object are built). */
export const analyzeHeadsStatement = (): RawBuilder<unknown> =>
  sql`analyze ${sql.table(CONTENT_HEADS_TABLE)}`;
