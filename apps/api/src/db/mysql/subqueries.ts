import {
  AliasNode,
  IdentifierNode,
  ListNode,
  OperationNodeTransformer,
  OperatorNode,
  SelectAllNode,
  SelectionNode,
  SelectQueryNode,
  TableNode,
  ValueListNode,
  ValuesNode,
  type BinaryOperationNode,
  type InsertQueryNode,
  type OperationNode,
  type QueryId,
  type UpdateQueryNode,
  type WhereNode,
} from 'kysely';

/**
 * Subquery shapes MySQL rejects, rewritten (ADR 0001, "MySQL"): `IN (… LIMIT n)` (error 1235) and a subquery
 * reading the table an UPDATE, DELETE or INSERT writes (error 1093) read a derived table instead, which MySQL
 * materialises first; PostgreSQL's `UPDATE … FROM` becomes a multi-table UPDATE.
 */

/** The alias of a derived table wrapped around a subquery. */
export const DERIVED_ALIAS = 'shapio_derived';

export const tableNameOf = (node: OperationNode | undefined): string | undefined =>
  node && TableNode.is(node) ? node.table.identifier.name : undefined;

/**
 * Whether an IN subquery must read a derived table: it has a LIMIT (MySQL rejects `IN (… LIMIT n)`), or it
 * reads `table`, the target of the enclosing UPDATE, DELETE or INSERT (error 1093).
 */
const needsDerivedTable = (node: SelectQueryNode, table: string | undefined): boolean =>
  node.limit !== undefined ||
  (table !== undefined &&
    ((node.from?.froms ?? []).some((item) => tableNameOf(AliasNode.is(item) ? item.node : item) === table) ||
      (node.joins ?? []).some(
        (join) => tableNameOf(AliasNode.is(join.table) ? join.table.node : join.table) === table,
      )));

/** `(select * from (<subquery>) as shapio_derived)`: MySQL materialises it first. */
const derived = (node: SelectQueryNode): SelectQueryNode =>
  Object.freeze({
    ...SelectQueryNode.createFrom([AliasNode.create(node, IdentifierNode.create(DERIVED_ALIAS))]),
    selections: [SelectionNode.create(SelectAllNode.create())],
  });

const IN_OPERATORS = new Set(['in', 'not in']);

/** Wraps the IN-subqueries of a WHERE tree that need it (see `needsDerivedTable`). */
class DerivedTableWrapper extends OperationNodeTransformer {
  readonly #table: string | undefined;

  constructor(table: string | undefined) {
    super();
    this.#table = table;
  }

  protected override transformBinaryOperation(node: BinaryOperationNode, queryId?: QueryId) {
    const transformed = super.transformBinaryOperation(node, queryId);
    const operator = OperatorNode.is(transformed.operator) ? transformed.operator.operator : '';
    const right = transformed.rightOperand;
    if (IN_OPERATORS.has(operator) && SelectQueryNode.is(right) && needsDerivedTable(right, this.#table)) {
      return Object.freeze({ ...transformed, rightOperand: derived(right) });
    }
    return transformed;
  }

  // Do not descend into subqueries' own WHERE: only the statement's top-level IN operands matter.
  protected override transformSelectQuery(node: SelectQueryNode): SelectQueryNode {
    return node;
  }
}

export const wrapSubqueries = (
  where: WhereNode | undefined,
  table: string | undefined,
): WhereNode | undefined => (where ? new DerivedTableWrapper(table).transformNode<WhereNode>(where) : where);

/**
 * An INSERT whose VALUES read the target table in a scalar subquery (`coalesce(max(position) + 1, 0)`):
 * MySQL rejects that (error 1093) unless the subquery reads a derived table, which it materialises first.
 */
export const withDerivedValueSubqueries = (node: InsertQueryNode): InsertQueryNode => {
  const table = node.into?.table.identifier.name;
  if (!table || !node.values || !ValuesNode.is(node.values)) {
    return node;
  }
  let changed = false;
  const rows = node.values.values.map((row) => {
    if (!ValueListNode.is(row)) {
      return row;
    }
    const values = row.values.map((value) => {
      if (SelectQueryNode.is(value) && needsDerivedTable(value, table)) {
        changed = true;
        return derived(value);
      }
      return value;
    });
    return ValueListNode.create(values);
  });
  return changed ? Object.freeze({ ...node, values: ValuesNode.create(rows) }) : node;
};

/**
 * `UPDATE t SET … FROM u WHERE …` (PostgreSQL) as MySQL's multi-table `UPDATE t, u SET … WHERE …`, which
 * joins the same way: the WHERE relates the tables.
 */
export const withFromAsTables = (node: UpdateQueryNode): UpdateQueryNode =>
  node.from && node.table
    ? Object.freeze({ ...node, table: ListNode.create([node.table, ...node.from.froms]), from: undefined })
    : node;
