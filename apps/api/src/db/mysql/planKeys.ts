import {
  AliasNode,
  AndNode,
  BinaryOperationNode,
  ColumnNode,
  IdentifierNode,
  OperatorNode,
  OrNode,
  ParensNode,
  PrimitiveValueListNode,
  ReferenceNode,
  SelectionNode,
  SelectQueryNode,
  TableNode,
  ValueNode,
  WhereNode,
  type OperationNode,
  type QueryResult,
  type ReturningNode,
  type UnknownRow,
} from 'kysely';
import { tableInfo, type MysqlTableInfo } from './tables.js';

/** Building blocks of statement plans (`plans.ts`): rows found again by their keys. */

export const ref = (column: string, table?: string): ReferenceNode =>
  ReferenceNode.create(ColumnNode.create(column), table === undefined ? undefined : TableNode.create(table));

export const equals = (left: OperationNode, right: OperationNode) =>
  BinaryOperationNode.create(left, OperatorNode.create('='), right);

export const valueNode = (value: unknown): OperationNode =>
  value !== null && typeof value === 'object' && 'kind' in value
    ? (value as OperationNode)
    : ValueNode.create(value);

/** `(k1 = v1 and k2 = v2) or (…)` over rows of key values (values may be expressions). */
export const keyMatch = (columns: readonly string[], keys: readonly (readonly unknown[])[]): WhereNode => {
  if (columns.length === 1) {
    const [column] = columns as [string];
    const values = keys.map((key) => key[0]);
    if (values.every((value) => !(value !== null && typeof value === 'object' && 'kind' in value))) {
      return WhereNode.create(
        BinaryOperationNode.create(
          ref(column),
          OperatorNode.create('in'),
          PrimitiveValueListNode.create(values),
        ),
      );
    }
  }
  const rows = keys.map((key) =>
    ParensNode.create(
      columns
        .map((column, index) => equals(ref(column), valueNode(key[index])) as OperationNode)
        .reduce((left, right) => AndNode.create(left, right)),
    ),
  );
  return WhereNode.create(
    rows.slice(1).reduce<OperationNode>((left, right) => OrNode.create(left, right), rows[0]!),
  );
};

const keyText = (values: readonly unknown[]) =>
  JSON.stringify(values.map((value) => String(value).toLowerCase()));

/** Rows in the order of `keys`, without the key columns the plan selected (expression keys keep the database's order). */
export const inKeyOrder = (
  rows: readonly UnknownRow[],
  columns: readonly string[],
  keys: readonly (readonly unknown[])[],
): UnknownRow[] => {
  const keyColumns = columns.map((_, index) => `__shapio_key_${index}`);
  const strip = (row: UnknownRow) =>
    Object.fromEntries(Object.entries(row).filter(([name]) => !keyColumns.includes(name)));
  if (keys.some((key) => key.some((value) => value !== null && typeof value === 'object'))) {
    return rows.map(strip);
  }
  const position = new Map(keys.map((key, index) => [keyText(key), index]));
  const positionOf = (row: UnknownRow) => position.get(keyText(keyColumns.map((column) => row[column]))) ?? 0;
  return [...rows].sort((a, b) => positionOf(a) - positionOf(b)).map(strip);
};

/** `select <returning>, <key columns as __shapio_key_i> from <table> where <keys>`. */
export const selectByKeys = (
  table: string,
  returning: ReturningNode,
  columns: readonly string[],
  keys: readonly (readonly unknown[])[],
): SelectQueryNode =>
  Object.freeze({
    ...SelectQueryNode.createFrom([TableNode.create(table)]),
    selections: [
      ...returning.selections,
      ...columns.map((column, index) =>
        SelectionNode.create(
          AliasNode.create(ref(column, table), IdentifierNode.create(`__shapio_key_${index}`)),
        ),
      ),
    ],
    where: keyMatch(columns, keys),
  });

export const infoOf = (table: string): MysqlTableInfo => {
  const info = tableInfo(table);
  if (!info) {
    throw new Error(`MySQL: RETURNING and ON CONFLICT need a Shapio table; ${table} is not one`);
  }
  return info;
};

export const tableOf = (node: OperationNode | undefined, statement: string): string => {
  const table = node && TableNode.is(node) ? node : undefined;
  if (!table) {
    throw new Error(`MySQL: ${statement} with RETURNING needs a single table without an alias`);
  }
  return table.table.identifier.name;
};

export const resultOf = (rows: UnknownRow[], affected: number): QueryResult<UnknownRow> => ({
  rows,
  numAffectedRows: BigInt(affected),
});

/** The value a VALUES row gives `column` (a primitive or an expression node). */
export const rowValue = (row: OperationNode, index: number): unknown => {
  if (PrimitiveValueListNode.is(row)) {
    return row.values[index];
  }
  const value = (row as unknown as { values: readonly OperationNode[] }).values[index];
  return value && ValueNode.is(value) ? value.value : value;
};
