import {
  AliasNode,
  BinaryOperationNode,
  ColumnNode,
  IdentifierNode,
  OperatorNode,
  ReferenceNode,
  SelectionNode,
  SelectModifierNode,
  SelectQueryNode,
  TableNode,
  type DeleteQueryNode,
  type UnknownRow,
  type UpdateQueryNode,
  type WhereNode,
} from 'kysely';
import { infoOf, inKeyOrder, keyMatch, ref, resultOf, selectByKeys, tableOf } from './planKeys.js';
import type { Compile, StatementPlan } from './planTypes.js';
import { DERIVED_ALIAS } from './subqueries.js';

/**
 * UPDATE/DELETE … RETURNING on MySQL (`plans.ts`): lock the matching keys (`SELECT … FOR UPDATE`, or the
 * statement's own `key IN (subquery)`), run the statement by key, then read the returned rows by key.
 */

const forUpdate = (node: SelectQueryNode): SelectQueryNode =>
  node.endModifiers?.some((modifier) => modifier.modifier === 'ForUpdate')
    ? node
    : Object.freeze({
        ...node,
        endModifiers: [...(node.endModifiers ?? []), SelectModifierNode.create('ForUpdate')],
      });

/** For `key in (subquery)` (possibly wrapped in the plugin's derived table): the subquery. */
const keySubquery = (where: WhereNode | undefined, key: readonly string[]): SelectQueryNode | undefined => {
  const condition = where?.where;
  if (
    key.length !== 1 ||
    !condition ||
    !BinaryOperationNode.is(condition) ||
    !OperatorNode.is(condition.operator) ||
    condition.operator.operator !== 'in' ||
    !ReferenceNode.is(condition.leftOperand) ||
    !ColumnNode.is(condition.leftOperand.column) ||
    condition.leftOperand.column.column.name !== key[0] ||
    !SelectQueryNode.is(condition.rightOperand)
  ) {
    return undefined;
  }
  const subquery = condition.rightOperand;
  const from = subquery.from?.froms[0];
  if (from && AliasNode.is(from) && IdentifierNode.is(from.alias) && from.alias.name === DERIVED_ALIAS) {
    return SelectQueryNode.is(from.node) ? from.node : undefined;
  }
  return subquery;
};

/** `select <key> from <table> where <where> [order/limit] for update` (or the key subquery itself). */
const lockingKeySelect = (
  table: string,
  key: readonly string[],
  node: UpdateQueryNode | DeleteQueryNode,
  extra: readonly SelectionNode[],
): SelectQueryNode => {
  const subquery = extra.length === 0 ? keySubquery(node.where, key) : undefined;
  if (subquery) {
    return forUpdate(subquery);
  }
  return forUpdate(
    Object.freeze({
      ...SelectQueryNode.createFrom([TableNode.create(table)]),
      selections: [
        ...extra,
        ...key.map((column, index) =>
          SelectionNode.create(
            AliasNode.create(ref(column, table), IdentifierNode.create(`__shapio_key_${index}`)),
          ),
        ),
      ],
      where: node.where,
      orderBy: node.orderBy,
      limit: node.limit,
    }),
  );
};

const keysOf = (rows: readonly UnknownRow[], key: readonly string[], bySubquery: boolean): unknown[][] =>
  rows.map((row) =>
    bySubquery ? [Object.values(row)[0]] : key.map((_, index) => row[`__shapio_key_${index}`]),
  );

export const updatePlan = (node: UpdateQueryNode, compile: Compile): StatementPlan => {
  const table = tableOf(node.table, 'UPDATE');
  if (node.from || node.joins?.length) {
    throw new Error(`MySQL: UPDATE … FROM/JOIN on ${table} cannot use RETURNING`);
  }
  const key = infoOf(table).primaryKey;
  const bySubquery = keySubquery(node.where, key) !== undefined;
  const lock = compile(lockingKeySelect(table, key, node, []));
  return (context) =>
    context.atomically(async () => {
      const keys = keysOf((await context.run(lock)).rows, key, bySubquery);
      if (keys.length === 0) {
        return resultOf([], 0);
      }
      await context.run(
        compile(
          Object.freeze({
            ...node,
            where: keyMatch(key, keys),
            returning: undefined,
            limit: undefined,
            orderBy: undefined,
          }),
        ),
      );
      const selected = await context.run(compile(selectByKeys(table, node.returning!, key, keys)));
      return resultOf(inKeyOrder(selected.rows, key, keys), keys.length);
    });
};

export const deletePlan = (node: DeleteQueryNode, compile: Compile): StatementPlan => {
  const table = tableOf(node.from.froms[0], 'DELETE');
  if (node.from.froms.length > 1 || node.using || node.joins?.length) {
    throw new Error(`MySQL: DELETE … USING/JOIN on ${table} cannot use RETURNING`);
  }
  const key = infoOf(table).primaryKey;
  const lock = compile(lockingKeySelect(table, key, node, node.returning!.selections));
  return (context) =>
    context.atomically(async () => {
      const locked = (await context.run(lock)).rows;
      const keys = keysOf(locked, key, false);
      if (keys.length === 0) {
        return resultOf([], 0);
      }
      await context.run(
        compile(
          Object.freeze({
            ...node,
            where: keyMatch(key, keys),
            returning: undefined,
            limit: undefined,
            orderBy: undefined,
          }),
        ),
      );
      return resultOf(inKeyOrder(locked, key, keys), keys.length);
    });
};
