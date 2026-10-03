import {
  AliasNode,
  type AggregateFunctionNode,
  type FunctionNode,
  type OperationNode,
  type ParensNode,
  IdentifierNode,
  OperationNodeTransformer,
  RawNode,
  ValueNode,
  type DefaultInsertValueNode,
  type InsertQueryNode,
  type KyselyPlugin,
  type OnConflictNode,
  type OrderByItemNode,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryId,
  type QueryResult,
  type RootOperationNode,
  type SelectionNode,
  type SelectQueryNode,
  type UnknownRow,
} from 'kysely';
import { markedResultType, type ResultType } from '../sql/typed.js';
import { indexExpressionSql, nullsNotDistinctIndexFor } from './nullsNotDistinct.js';

/** Row-lock modifiers PostgreSQL needs and SQLite rejects; its write transactions are already serialised. */
const ROW_LOCKS = new Set(['ForUpdate', 'ForNoKeyUpdate', 'ForShare', 'ForKeyShare', 'NoWait', 'SkipLocked']);

const MARKERS = new WeakMap<QueryId, ReadonlyMap<string, ResultType>>();

/** The result-type markers of a query's output columns (read by the driver when it decodes rows). */
export const markersOf = (queryId: QueryId): ReadonlyMap<string, ResultType> | undefined =>
  MARKERS.get(queryId);

const selectionsOf = (node: RootOperationNode): readonly SelectionNode[] | undefined => {
  switch (node.kind) {
    case 'SelectQueryNode':
      return node.selections;
    case 'InsertQueryNode':
    case 'UpdateQueryNode':
    case 'DeleteQueryNode':
      return node.returning?.selections;
    default:
      return undefined;
  }
};

/** Functions whose result has the type of their (marked) arguments. */
const TYPE_PRESERVING_FUNCTIONS = new Set(['coalesce', 'max', 'min', 'ifnull']);
/** Aggregates PostgreSQL returns as bigint/numeric, which its driver reads as decimal strings. */
const BIGINT_AGGREGATES = new Set(['count', 'sum']);

/**
 * The marker of an expression: its own, or one it inherits through `coalesce`/`max`/`min`, parentheses
 * and scalar subqueries (`coalesce((select asJson(…) …), emptyArray())` needs no second marker).
 * `count` and `sum` read as decimal strings, like PostgreSQL's bigint and numeric.
 */
const markerOf = (node: OperationNode | undefined): ResultType | undefined => {
  if (!node) {
    return undefined;
  }
  const own = markedResultType(node);
  if (own) {
    return own;
  }
  switch (node.kind) {
    case 'AliasNode':
      return markerOf((node as AliasNode).node);
    case 'ParensNode':
      return markerOf((node as ParensNode).node);
    case 'SelectionNode':
      return markerOf((node as SelectionNode).selection);
    case 'SelectQueryNode': {
      const selections = (node as SelectQueryNode).selections;
      return selections?.length === 1 ? markerOf(selections[0]) : undefined;
    }
    case 'AggregateFunctionNode':
    case 'FunctionNode': {
      const call = node as Partial<FunctionNode> & Partial<AggregateFunctionNode>;
      if (node.kind === 'AggregateFunctionNode' && BIGINT_AGGREGATES.has(String(call.func).toLowerCase())) {
        return 'bigint';
      }
      if (!TYPE_PRESERVING_FUNCTIONS.has(String(call.func).toLowerCase())) {
        return undefined;
      }
      for (const argument of call.aggregated ?? call.arguments ?? []) {
        const marker = markerOf(argument);
        if (marker) {
          return marker;
        }
      }
      return undefined;
    }
    default:
      return undefined;
  }
};

/** Output column name → marker, for top-level selections that are (or inherit) marked expressions. */
const collectMarkers = (node: RootOperationNode): Map<string, ResultType> | undefined => {
  let markers: Map<string, ResultType> | undefined;
  for (const selection of selectionsOf(node) ?? []) {
    const aliased = selection.selection;
    if (!AliasNode.is(aliased) || !IdentifierNode.is(aliased.alias)) {
      continue;
    }
    const type = markerOf(aliased.node);
    if (type) {
      markers ??= new Map();
      markers.set(aliased.alias.name, type);
    }
  }
  return markers;
};

/** `asc`/`desc` from an order item's direction node (Kysely emits it as a raw `asc`/`desc`). */
const directionOf = (node: OrderByItemNode): 'asc' | 'desc' => {
  const direction = node.direction;
  if (direction && RawNode.is(direction)) {
    return direction.sqlFragments.join('').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
  }
  return 'asc';
};

/** Writes bound values as literals (SQLite proves a partial index's WHERE only from literal values). */
class InlineValues extends OperationNodeTransformer {
  protected override transformValue(node: ValueNode): ValueNode {
    return node.immediate ? node : ValueNode.createImmediate(node.value);
  }
}

const inlineValues = new InlineValues();

/** The conflict target's WHERE (matching a partial unique index) with its values written inline. */
const withInlineIndexWhere = (node: OnConflictNode): OnConflictNode =>
  node.indexWhere
    ? Object.freeze({ ...node, indexWhere: inlineValues.transformNode(node.indexWhere) })
    : node;

class SqliteTransformer extends OperationNodeTransformer {
  #insertTable: string | undefined;

  protected override transformSelectQuery(node: SelectQueryNode, queryId?: QueryId): SelectQueryNode {
    const transformed = super.transformSelectQuery(node, queryId);
    const modifiers = transformed.endModifiers?.filter(
      (modifier) => modifier.modifier === undefined || !ROW_LOCKS.has(modifier.modifier),
    );
    if (modifiers === transformed.endModifiers) {
      return transformed;
    }
    return Object.freeze({
      ...transformed,
      endModifiers: modifiers?.length ? Object.freeze(modifiers) : undefined,
    });
  }

  /** PostgreSQL places NULLs last ascending and first descending; SQLite does the reverse. Keep PostgreSQL's. */
  protected override transformOrderByItem(node: OrderByItemNode, queryId?: QueryId): OrderByItemNode {
    const transformed = super.transformOrderByItem(node, queryId);
    if (transformed.nulls) {
      return transformed;
    }
    const rawOrder = RawNode.is(transformed.orderBy) ? transformed.orderBy.sqlFragments.join(' ') : '';
    if (/\b(asc|desc|nulls)\s*$/i.test(rawOrder)) {
      throw new Error(
        `Write the direction with orderBy(expr, 'asc' | 'desc'), not inside raw SQL: ${rawOrder}`,
      );
    }
    return Object.freeze({ ...transformed, nulls: directionOf(transformed) === 'asc' ? 'last' : 'first' });
  }

  protected override transformInsertQuery(node: InsertQueryNode, queryId?: QueryId): InsertQueryNode {
    const previous = this.#insertTable;
    this.#insertTable = node.into?.table.identifier.name;
    try {
      return super.transformInsertQuery(node, queryId);
    } finally {
      this.#insertTable = previous;
    }
  }

  /** A column target on a NULLS NOT DISTINCT constraint becomes the SQLite index's expressions. */
  protected override transformOnConflict(node: OnConflictNode, queryId?: QueryId): OnConflictNode {
    const transformed = withInlineIndexWhere(super.transformOnConflict(node, queryId));
    const columns = transformed.columns?.map((column) => column.column.name);
    const index =
      columns && this.#insertTable !== undefined
        ? nullsNotDistinctIndexFor(this.#insertTable, columns)
        : undefined;
    if (!index) {
      return transformed;
    }
    return Object.freeze({
      ...transformed,
      columns: undefined,
      indexExpression: RawNode.createWithSql(indexExpressionSql(index)),
    });
  }

  /** SQLite has no DEFAULT keyword in VALUES; Kysely would write NULL there instead of the default. */
  protected override transformDefaultInsertValue(_node: DefaultInsertValueNode): DefaultInsertValueNode {
    throw new Error(
      'A multi-row insert leaves a column out of some rows; SQLite cannot insert DEFAULT there. Give every row the same columns.',
    );
  }
}

/**
 * Adapts Kysely queries written for PostgreSQL to SQLite (dialect boundary, ADR 0001): drops row locks,
 * spells out PostgreSQL's NULL ordering, retargets conflicts on NULLS NOT DISTINCT constraints and records
 * the result-type markers of computed columns for the driver.
 */
export class SqlitePlugin implements KyselyPlugin {
  readonly #transformer = new SqliteTransformer();

  transformQuery({ node, queryId }: PluginTransformQueryArgs): RootOperationNode {
    const markers = collectMarkers(node);
    if (markers) {
      MARKERS.set(queryId, markers);
    }
    return this.#transformer.transformNode(node, queryId);
  }

  async transformResult({ result }: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return result;
  }
}
