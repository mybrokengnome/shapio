import {
  AndNode,
  ColumnNode,
  OperationNodeTransformer,
  ParensNode,
  TableNode,
  UpdateQueryNode,
  ValuesNode,
  WhereNode,
  type ColumnUpdateNode,
  type InsertQueryNode,
  type OnConflictNode,
  type OperationNode,
  type QueryResult,
  type ReferenceNode,
  type UnknownRow,
} from 'kysely';
import { sameColumns } from './conflicts.js';
import { isDuplicateKeyOn } from './errors.js';
import {
  infoOf,
  inKeyOrder,
  keyMatch,
  resultOf,
  rowValue,
  selectByKeys,
  tableOf,
  valueNode,
} from './planKeys.js';
import type { Compile, StatementPlan } from './planTypes.js';

/**
 * INSERT … RETURNING and INSERT … ON CONFLICT on MySQL (`plans.ts`): the insert, then the returned rows by
 * key; with a conflict target, each row under a savepoint, a duplicate on the target skipped or turned into
 * an UPDATE of the row it found.
 */

/** Replaces `excluded.<column>` references with the values one VALUES row gives those columns. */
class ExcludedRowValues extends OperationNodeTransformer {
  readonly #value: (column: string) => OperationNode;

  constructor(value: (column: string) => OperationNode) {
    super();
    this.#value = value;
  }

  protected override transformReference(node: ReferenceNode): ReferenceNode {
    if (node.table?.table.identifier.name === 'excluded' && ColumnNode.is(node.column)) {
      return this.#value(node.column.column.name) as ReferenceNode;
    }
    return node;
  }
}

/**
 * The UPDATE `ON CONFLICT (target) DO UPDATE SET … [WHERE …]` runs on the row the target found, with the
 * proposed row's values in place of `excluded.*`.
 */
const conflictUpdate = (
  table: string,
  conflict: OnConflictNode,
  target: readonly string[],
  value: (column: string) => OperationNode,
): UpdateQueryNode => {
  const replace = new ExcludedRowValues(value);
  const match = keyMatch(target, [target.map((column) => value(column))]).where;
  const where = conflict.updateWhere
    ? AndNode.create(match, ParensNode.create(replace.transformNode(conflict.updateWhere.where)))
    : match;
  return Object.freeze({
    ...UpdateQueryNode.create([TableNode.create(table)]),
    updates: (conflict.updates ?? []).map((update) => replace.transformNode<ColumnUpdateNode>(update)),
    where: WhereNode.create(where),
  });
};

export const insertPlan = (node: InsertQueryNode, compile: Compile): StatementPlan => {
  const table = tableOf(node.into, 'INSERT');
  const info = infoOf(table);
  if (!node.values || !ValuesNode.is(node.values) || !node.columns) {
    throw new Error(`MySQL: INSERT … SELECT into ${table} cannot use RETURNING or ON CONFLICT DO NOTHING`);
  }
  const columns = node.columns.map((column) => column.column.name);
  const rows = node.values.values;
  const conflict = node.onConflict;
  const target = conflict?.columns?.map((column) => column.column.name);
  const targetIndexes = target
    ? new Set(info.uniqueKeys.filter((key) => sameColumns(key.columns, target)).map((key) => key.name))
    : undefined;
  if (targetIndexes && targetIndexes.size === 0) {
    throw new Error(`MySQL: no unique key on ${table} (${target!.join(', ')}) for ON CONFLICT`);
  }
  const identityKey = info.identity !== undefined && !columns.includes(info.identity);
  const perRow = conflict !== undefined || (identityKey && node.returning !== undefined);
  const base = Object.freeze({ ...node, onConflict: undefined, returning: undefined });
  const statements = perRow
    ? rows.map((row) => compile(Object.freeze({ ...base, values: ValuesNode.create([row]) })))
    : [compile(base)];
  const updates = conflict !== undefined && !conflict.doNothing;
  if (updates && !target) {
    throw new Error(`MySQL: ON CONFLICT DO UPDATE on ${table} needs a conflict target`);
  }
  // An upsert may return a row it updated (another primary key): it is found by its target instead.
  const keyColumns = updates ? target! : identityKey ? [info.identity!] : info.primaryKey;
  const valueOf = (rowIndex: number) => (column: string) => {
    const index = columns.indexOf(column);
    if (index < 0) {
      throw new Error(`MySQL: ON CONFLICT on ${table} refers to ${column}, which the insert leaves out`);
    }
    return valueNode(rowValue(rows[rowIndex]!, index));
  };
  const keyOf = (rowIndex: number, insertId: bigint | undefined): unknown[] =>
    identityKey && !updates
      ? [String(insertId)]
      : keyColumns.map((column) => rowValue(rows[rowIndex]!, columns.indexOf(column)));

  return (context) =>
    context.atomically(async () => {
      const keys: unknown[][] = [];
      let affected = 0;
      for (const [index, statement] of statements.entries()) {
        let result: QueryResult<UnknownRow>;
        try {
          result = conflict
            ? await context.savepoint(() => context.run(statement))
            : await context.run(statement);
        } catch (error) {
          if (!conflict || !isDuplicateKeyOn(error, targetIndexes)) {
            throw error;
          }
          if (!updates) {
            continue;
          }
          result = await context.run(compile(conflictUpdate(table, conflict, target!, valueOf(index))));
          if (Number(result.numAffectedRows ?? 0n) === 0) {
            // The update's WHERE excluded the row: PostgreSQL returns nothing for it either.
            continue;
          }
        }
        affected += Number(result.numAffectedRows ?? 0n);
        if (perRow) {
          keys.push(keyOf(index, result.insertId));
        } else {
          keys.push(...rows.map((_, rowIndex) => keyOf(rowIndex, result.insertId)));
        }
      }
      if (!node.returning || keys.length === 0) {
        return resultOf([], affected);
      }
      const selected = await context.run(compile(selectByKeys(table, node.returning, keyColumns, keys)));
      return resultOf(inKeyOrder(selected.rows, keyColumns, keys), affected);
    });
};
