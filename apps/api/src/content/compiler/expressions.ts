import { createHash } from 'node:crypto';
import { isStableId, SCALAR_DATA_TYPES, type DataType } from '@shapio/schema';
import { sql, type RawBuilder } from 'kysely';
import { contentDialect } from './currentDialect.js';
import type { ContentSqlDialect, EqualityTarget, TextMatchOperator, ValueCast } from './dialect/types.js';
import { CONTENT_HEADS_COLUMNS, CONTENT_HEADS_TABLE } from './heads.js';

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
 * The spelling of each expression comes from the content dialect (`dialect/`): the same functions build
 * the query and the index on PostgreSQL, and the same functions build them on SQLite.
 *
 * Field IDs are embedded as SQL literals, never parameters, because a parameterised expression cannot
 * match an index expression. That is safe only because field IDs come from the registry and are checked
 * to be UUIDs here; nothing from a request ever reaches these functions unvalidated.
 */

export { CONTENT_HEADS_COLUMNS, CONTENT_HEADS_TABLE } from './heads.js';
export type { ValueCast } from './dialect/types.js';

/** Bump when any expression below changes: index names change with it, so old indexes are rebuilt. */
export const EXPRESSION_VERSION = 1;

/**
 * Column layout of field indexes. 1: (locale, state, value). 2 (sites plan §H): `site_id` leads, because
 * every content query names its site. The layout is part of the index name, so a new layout means new
 * indexes; the `fieldIndexLayout` job builds the current layout and drops the old one.
 */
export type FieldIndexLayout = 1 | 2;
export const FIELD_INDEX_LAYOUT: FieldIndexLayout = 2;

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
 * The expression for one top-level scalar field of a head's `data`, e.g. `((data ->> '0b1c…')::numeric)`
 * on PostgreSQL. Throws for non-scalar types or a malformed field ID.
 */
export const fieldValueExpression = (
  fieldId: string,
  type: DataType,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => {
  assertStableId(fieldId, 'a field ID');
  if (!SCALAR_DATA_TYPES.has(type)) {
    throw new Error(`${type} fields have no scalar expression`);
  }
  return dialect.fieldValue(fieldId, valueCastFor(type));
};

/** `data -> 'fieldId'`: the raw JSON value of a top-level field (any type). */
export const fieldJsonExpression = (
  fieldId: string,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => {
  assertStableId(fieldId, 'a field ID');
  return dialect.fieldJson(fieldId);
};

/** `data ->> 'fieldId'`: a top-level field as text, uncast. */
export const fieldTextExpression = (
  fieldId: string,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => {
  assertStableId(fieldId, 'a field ID');
  return dialect.fieldText(fieldId);
};

/**
 * Equality on a top-level field (lists: "contains"). PostgreSQL emits containment, which its GIN index
 * serves; SQLite compares the field's index expression.
 */
export const fieldEqualsExpression = (
  target: EqualityTarget,
  value: unknown,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => {
  assertStableId(target.fieldId, 'a field ID');
  return dialect.fieldEquals(target, value);
};

/** The field's value is missing: absent, null, "" or []. */
export const fieldMissingExpression = (
  fieldId: string,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => {
  assertStableId(fieldId, 'a field ID');
  return dialect.fieldMissing(fieldId);
};

/** Case-sensitive text match on a top-level field; `text` is a parameter, never SQL. */
export const textMatchExpression = (
  fieldId: string,
  operator: TextMatchOperator,
  text: string,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => {
  assertStableId(fieldId, 'a field ID');
  return dialect.textMatch(fieldId, operator, text);
};

/** Case-insensitive contains on a top-level field (`$containsi`, search). */
export const containsInsensitiveExpression = (
  fieldId: string,
  text: string,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => {
  assertStableId(fieldId, 'a field ID');
  return dialect.containsInsensitive(fieldId, text);
};

/**
 * The model ID as a SQL literal for `model_id = '…'`. Expression indexes are partial on the model, and
 * the planner can only prove a partial index's predicate against a literal, never a parameter.
 */
export const modelIdLiteral = (modelId: string): RawBuilder<unknown> => {
  assertStableId(modelId, 'a model ID');
  return sql.lit(modelId);
};

/** A comparison value cast the way `fieldValueExpression` casts the stored value, so indexes match. */
export const castParameter = (
  value: unknown,
  type: DataType,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => dialect.castParameter(value, valueCastFor(type));

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
 * changed one to a new one. 63 bytes is PostgreSQL's identifier limit; this is 3 + 32. `layoutVersion` 1
 * gives the names indexes had before sites (to drop them). A database has one dialect, so the name does
 * not depend on it.
 */
export const fieldIndexName = (
  { modelId, fieldId, type, localized = true }: FieldIndexSpec,
  layoutVersion: FieldIndexLayout = FIELD_INDEX_LAYOUT,
): string => {
  const layout = `${localized ? '' : ':shared'}${layoutVersion === 1 ? '' : `:l${layoutVersion}`}`;
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
 * The field index over the model's heads only: (site, locale, state, value) for localized models, (site,
 * state, value) otherwise; the site leads because every query names one (the compiler's base condition).
 * PostgreSQL builds it `CONCURRENTLY` (outside a transaction); SQLite with a plain `CREATE INDEX`, which
 * holds the write lock while it builds. One index serves equality, ranges and sorts on SQLite.
 */
export const createFieldIndexStatement = (
  spec: FieldIndexSpec,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => {
  assertStableId(spec.modelId, 'a model ID');
  const { siteId, modelId, locale, state } = CONTENT_HEADS_COLUMNS;
  const leading =
    spec.localized === false
      ? sql`${sql.ref(siteId)}, ${sql.ref(state)}`
      : sql`${sql.ref(siteId)}, ${sql.ref(locale)}, ${sql.ref(state)}`;
  return dialect.createFieldIndex({
    name: fieldIndexName(spec),
    table: CONTENT_HEADS_TABLE,
    leading,
    expression: fieldValueExpression(spec.fieldId, spec.type, dialect),
    modelIdColumn: modelId,
    modelId: sql.lit(spec.modelId),
  });
};

/**
 * `CREATE STATISTICS` on the field's value expression (the same expression the index and queries use);
 * null where the database has no extended statistics (SQLite).
 */
export const createFieldStatisticsStatement = (
  spec: FieldIndexSpec,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> | null =>
  dialect.createFieldStatistics(
    fieldStatisticsName(fieldIndexName(spec)),
    fieldValueExpression(spec.fieldId, spec.type, dialect),
    CONTENT_HEADS_TABLE,
  );

/** Drops a field index (`CONCURRENTLY` on PostgreSQL); names only ever come from `fieldIndexName`. */
export const dropIndexStatement = (
  indexName: string,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => {
  assertIndexName(indexName);
  return dialect.dropFieldIndex(indexName);
};

/** Drops the statistics object of a field index (`fieldStatisticsName`); null where there is none. */
export const dropStatisticsStatement = (
  indexName: string,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> | null => dialect.dropFieldStatistics(fieldStatisticsName(indexName));

/** Refreshes planner statistics of the heads table (after an index and its statistics object are built). */
export const analyzeHeadsStatement = (dialect: ContentSqlDialect = contentDialect()): RawBuilder<unknown> =>
  dialect.analyze(CONTENT_HEADS_TABLE);
