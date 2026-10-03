import {
  AliasNode,
  BinaryOperationNode,
  ColumnNode,
  IdentifierNode,
  OperatorNode,
  OrderByItemNode,
  ParensNode,
  RawNode,
  ReferenceNode,
  ValueNode,
  type FromNode,
  type JoinNode,
  type OperationNode,
} from 'kysely';
import { tableNameOf } from './subqueries.js';
import { tableInfo } from './tables.js';

/**
 * PostgreSQL's NULL placement on MySQL (ADR 0001, "MySQL"): PostgreSQL sorts NULLs last ascending and first
 * descending, MySQL the reverse. An ORDER BY item that may be NULL gets an `(expr is null)` item before it;
 * a NOT NULL column of a table in scope (`tables.ts`) does not, so index-ordered scans stay possible.
 */

/** `asc`/`desc` from an order item's direction node. */
const directionOf = (node: OrderByItemNode): 'asc' | 'desc' => {
  const direction = node.direction;
  if (direction && RawNode.is(direction)) {
    return direction.sqlFragments.join('').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
  }
  return 'asc';
};

/** Tables in scope of one query level: alias (or name) → table, and whether a LEFT JOIN may null them. */
export type Scope = Map<string, { table: string; outer: boolean }>;

const addToScope = (scope: Scope, node: OperationNode, outer: boolean) => {
  if (AliasNode.is(node) && IdentifierNode.is(node.alias)) {
    const table = tableNameOf(node.node);
    if (table) {
      scope.set(node.alias.name, { table, outer });
    }
    return;
  }
  const table = tableNameOf(node);
  if (table) {
    scope.set(table, { table, outer });
  }
};

export const scopeOf = (
  from: FromNode | undefined,
  joins: readonly JoinNode[] | undefined,
  extra?: string,
): Scope => {
  const scope: Scope = new Map();
  for (const item of from?.froms ?? []) {
    addToScope(scope, item, false);
  }
  for (const join of joins ?? []) {
    addToScope(scope, join.table, join.joinType !== 'InnerJoin');
  }
  if (extra) {
    scope.set(extra, { table: extra, outer: false });
  }
  return scope;
};

/** Whether an ORDER BY expression can never be NULL (a NOT NULL column of a table in scope). */
const neverNull = (node: OperationNode, scope: Scope): boolean => {
  if (!ReferenceNode.is(node) || !ColumnNode.is(node.column)) {
    return false;
  }
  const column = node.column.column.name;
  const qualifier = node.table?.table.identifier.name;
  const candidates = qualifier
    ? [scope.get(qualifier)].filter((entry) => entry !== undefined)
    : [...scope.values()].filter((entry) => tableInfo(entry.table)?.columns.includes(column));
  if (candidates.length !== 1) {
    return false;
  }
  const entry = candidates[0]!;
  const info = tableInfo(entry.table);
  return (
    !entry.outer && info !== undefined && info.columns.includes(column) && !info.nullable.includes(column)
  );
};

const isNull = (expression: OperationNode): OperationNode =>
  ParensNode.create(
    BinaryOperationNode.create(expression, OperatorNode.create('is'), ValueNode.createImmediate(null)),
  );

const withDirection = (node: OperationNode, direction: 'asc' | 'desc'): OrderByItemNode =>
  OrderByItemNode.create(node, RawNode.createWithSql(direction));

/** True when a raw ORDER BY item already spells its own direction (the content compiler's SQL). */
const spellsDirection = (node: OrderByItemNode): boolean =>
  RawNode.is(node.orderBy) && /\b(asc|desc)\b/i.test(node.orderBy.sqlFragments.join(' '));

/** PostgreSQL's NULL placement for one ORDER BY item, as MySQL items. */
export const orderItems = (item: OrderByItemNode, scope: Scope): OrderByItemNode[] => {
  if (spellsDirection(item)) {
    return [item];
  }
  const direction = directionOf(item);
  const nullsLast = item.nulls ? item.nulls === 'last' : direction === 'asc';
  // MySQL already puts NULLs first ascending and last descending.
  const mysqlNullsLast = direction === 'desc';
  const plain = Object.freeze({ ...item, nulls: undefined });
  if (nullsLast === mysqlNullsLast || neverNull(item.orderBy, scope)) {
    return [plain];
  }
  return [withDirection(isNull(item.orderBy), nullsLast ? 'asc' : 'desc'), plain];
};
