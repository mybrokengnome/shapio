import type { RawBuilder } from 'kysely';

/**
 * The SQL a content dialect owns (ADR 0001, "D2: as built"). The compiler and the index builder ask the
 * dialect for every database-specific fragment, so the shape of a query (and its plan) is decided once in
 * `compile.ts`, `sort.ts`, `policy.ts` and `expressions.ts`, and only its spelling differs per database.
 *
 * Inputs are already safe: field, model and index identifiers are checked by `expressions.ts` before a
 * dialect sees them (stable IDs, deterministic index names), and every value is a bound parameter.
 */
export type ContentDialectName = 'postgres' | 'sqlite';

/** How a scalar value compares: text (dates are ISO text), numeric, or boolean. */
export type ValueCast = 'text' | 'numeric' | 'boolean';

/** Element type of a bound list (`oneOf`). */
export type ListElement = 'uuid' | 'text' | 'timestamp';

/** Case-sensitive text matches; `$containsi` is `containsInsensitive`. */
export type TextMatchOperator = '$contains' | '$notContains' | '$startsWith' | '$endsWith';

/** What equality needs to know about a top-level field. */
export type EqualityTarget = {
  fieldId: string;
  /** The value cast of a scalar type; null for non-scalar single values (one relation, one media asset). */
  cast: ValueCast | null;
  /** The field holds a list: equality means "contains". */
  list: boolean;
  /** decimal and biginteger: JSON strings that compare numerically. */
  numericString: boolean;
};

/** A field index, with its parts already built by `expressions.ts`. */
export type FieldIndexDefinition = {
  name: string;
  table: string;
  /** `site_id[, locale], state` as SQL. */
  leading: RawBuilder<unknown>;
  /** The field's value expression: the same one queries use. */
  expression: RawBuilder<unknown>;
  modelIdColumn: string;
  /** The model ID as a literal (partial-index predicates only match literals). */
  modelId: RawBuilder<unknown>;
};

/** The snapshot CTE's inputs (`compile.ts`). */
export type SnapshotSource = { name: string; siteId: string; modelId: RawBuilder<unknown>; seq: number };

export type ContentSqlDialect = {
  name: ContentDialectName;

  /** A UUID parameter. */
  uuid: (value: string) => RawBuilder<unknown>;
  /** A timestamp parameter from a canonical ISO-8601 UTC string, comparable with timestamp columns. */
  timestamp: (value: string) => RawBuilder<unknown>;
  /** A boolean (row-filter constants). */
  bool: (value: boolean) => RawBuilder<unknown>;
  /** `column` is one of `values`, bound as one parameter whatever the list length. */
  oneOf: (
    column: RawBuilder<unknown>,
    values: readonly string[],
    element: ListElement,
  ) => RawBuilder<boolean>;

  /** A top-level scalar field cast for comparison and sorting: the expression field indexes are built on. */
  fieldValue: (fieldId: string, cast: ValueCast) => RawBuilder<unknown>;
  /** A top-level field as text, uncast. */
  fieldText: (fieldId: string) => RawBuilder<unknown>;
  /** A top-level field's raw JSON. */
  fieldJson: (fieldId: string) => RawBuilder<unknown>;
  /** A comparison value cast the way `fieldValue` casts the stored value. */
  castParameter: (value: unknown, cast: ValueCast) => RawBuilder<unknown>;

  /** Equality (lists: membership). False, never null, for a missing value, except numeric strings. */
  fieldEquals: (target: EqualityTarget, value: unknown) => RawBuilder<unknown>;
  /** The value is missing: absent, null, "" or []. */
  fieldMissing: (fieldId: string) => RawBuilder<unknown>;
  /** Case-sensitive contains / starts with / ends with / does not contain. */
  textMatch: (fieldId: string, operator: TextMatchOperator, text: string) => RawBuilder<unknown>;
  /** Case-insensitive contains (`$containsi`, search). */
  containsInsensitive: (fieldId: string, text: string) => RawBuilder<unknown>;

  /** The position of `column` in the locale chain (lower = preferred). */
  localeRank: (chain: readonly string[], column: RawBuilder<unknown>) => RawBuilder<unknown>;
  /** ORDER BY direction. Nullable sort keys put missing values last ascending and first descending. */
  sortDirection: (direction: 'asc' | 'desc', nullable: boolean) => RawBuilder<unknown>;
  /** `with <name> as (published revisions of the model as of the sequence) ` (note the trailing space). */
  snapshotCte: (source: SnapshotSource) => RawBuilder<unknown>;

  /** Builds a field index without blocking writers where the database can. */
  createFieldIndex: (index: FieldIndexDefinition) => RawBuilder<unknown>;
  /** Extended statistics on the value expression; null where the database has none. */
  createFieldStatistics: (
    name: string,
    expression: RawBuilder<unknown>,
    table: string,
  ) => RawBuilder<unknown> | null;
  dropFieldIndex: (name: string) => RawBuilder<unknown>;
  dropFieldStatistics: (name: string) => RawBuilder<unknown> | null;
  /** Refreshes planner statistics of a table. */
  analyze: (table: string) => RawBuilder<unknown>;
};
