import {
  AliasNode,
  ColumnNode,
  OperationNodeTransformer,
  RawNode,
  ReferenceNode,
  type BinaryOperationNode,
  type CastNode,
  type DataTypeNode,
  type DeleteQueryNode,
  type InsertQueryNode,
  type KyselyPlugin,
  type OrderByNode,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryId,
  type QueryResult,
  type RootOperationNode,
  type SelectModifierNode,
  type SelectQueryNode,
  type UnknownRow,
  type UpdateQueryNode,
} from 'kysely';
import { collectMarkers } from '../sql/markers.js';
import type { ResultType } from '../sql/typed.js';
import { toOnDuplicateKey } from './conflicts.js';
import {
  isTimestampColumn,
  timestampValue,
  withGeneratedColumns,
  withTimestampValues,
} from './insertValues.js';
import { orderItems, scopeOf, type Scope } from './nullOrdering.js';
import { decodeRow } from './resultDecoding.js';
import { tableNameOf, withDerivedValueSubqueries, withFromAsTables, wrapSubqueries } from './subqueries.js';
import { tableInfo } from './tables.js';

/**
 * Adapts Kysely queries written for PostgreSQL to MySQL (dialect boundary, ADR 0001, "MySQL"). Rewrites that
 * stay one statement happen here; statements MySQL cannot run as one (`RETURNING`, most `ON CONFLICT`) are
 * planned by the compiler (`plans.ts`). This plugin:
 * - fills the columns PostgreSQL defaults that MySQL cannot, and normalises ISO text bound to timestamp
 *   columns (`insertValues.ts`);
 * - spells casts MySQL's way (`text` → `char`, `bigint`/`integer` → `signed`) and maps row locks MySQL lacks;
 * - keeps PostgreSQL's NULL placement in ORDER BY (`nullOrdering.ts`);
 * - turns `ON CONFLICT` into `ON DUPLICATE KEY UPDATE` where that means the same (`conflicts.ts`);
 * - rewrites the subquery shapes MySQL rejects and `UPDATE … FROM` (`subqueries.ts`);
 * - decodes result columns marked with `db/sql/typed.ts` (MySQL computes comparisons as integers).
 */

const CAST_TYPES: Readonly<Record<string, string>> = {
  text: 'char',
  uuid: 'char(36)',
  integer: 'signed',
  bigint: 'signed',
  int4: 'signed',
  int8: 'signed',
  numeric: 'decimal(65,30)',
};

const ROW_LOCKS: Readonly<Record<string, string>> = {
  ForNoKeyUpdate: 'ForUpdate',
  ForKeyShare: 'ForShare',
};

const emptyScope = (): Scope => new Map<string, { table: string; outer: boolean }>();

class MysqlTransformer extends OperationNodeTransformer {
  readonly #scopes: Scope[] = [];

  protected override transformSelectQuery(node: SelectQueryNode, queryId?: QueryId): SelectQueryNode {
    this.#scopes.push(scopeOf(node.from, node.joins));
    try {
      const transformed = super.transformSelectQuery(node, queryId);
      const where = wrapSubqueries(transformed.where, undefined);
      return where === transformed.where ? transformed : Object.freeze({ ...transformed, where });
    } finally {
      this.#scopes.pop();
    }
  }

  protected override transformUpdateQuery(node: UpdateQueryNode, queryId?: QueryId): UpdateQueryNode {
    const table = tableNameOf(node.table && AliasNode.is(node.table) ? node.table.node : node.table);
    this.#scopes.push(scopeOf(node.from, node.joins, table));
    try {
      const transformed = super.transformUpdateQuery(node, queryId);
      const multiTable = withFromAsTables(transformed);
      const updates = multiTable.updates?.map((update) =>
        ColumnNode.is(update.column) && isTimestampColumn(table, update.column.column.name)
          ? Object.freeze({ ...update, value: timestampValue(update.value) })
          : update,
      );
      return Object.freeze({ ...multiTable, updates, where: wrapSubqueries(multiTable.where, table) });
    } finally {
      this.#scopes.pop();
    }
  }

  protected override transformDeleteQuery(node: DeleteQueryNode, queryId?: QueryId): DeleteQueryNode {
    const table = tableNameOf(node.from.froms[0]);
    this.#scopes.push(scopeOf(node.from, node.joins));
    try {
      const transformed = super.transformDeleteQuery(node, queryId);
      return Object.freeze({ ...transformed, where: wrapSubqueries(transformed.where, table) });
    } finally {
      this.#scopes.pop();
    }
  }

  protected override transformInsertQuery(node: InsertQueryNode, queryId?: QueryId): InsertQueryNode {
    const transformed = withTimestampValues(
      withDerivedValueSubqueries(super.transformInsertQuery(node, queryId)),
    );
    const table = transformed.into?.table.identifier.name;
    const info = table === undefined ? undefined : tableInfo(table);
    let result = transformed;
    // Before generated columns are added: a conflict key the statement leaves out is generated fresh.
    if (table && transformed.onConflict) {
      result = toOnDuplicateKey(result, transformed.onConflict, table);
    }
    return info ? withGeneratedColumns(result, info) : result;
  }

  protected override transformOrderBy(node: OrderByNode, queryId?: QueryId): OrderByNode {
    const transformed = super.transformOrderBy(node, queryId);
    const scope = this.#scopes.at(-1) ?? emptyScope();
    return Object.freeze({
      ...transformed,
      items: transformed.items.flatMap((item) => orderItems(item, scope)),
    });
  }

  /** `timestamp_column <op> 'ISO text'`: the text as UTC DATETIME text. */
  protected override transformBinaryOperation(
    node: BinaryOperationNode,
    queryId?: QueryId,
  ): BinaryOperationNode {
    const transformed = super.transformBinaryOperation(node, queryId);
    const left = transformed.leftOperand;
    if (!ReferenceNode.is(left) || !ColumnNode.is(left.column)) {
      return transformed;
    }
    const column = left.column.column.name;
    const scope = this.#scopes.at(-1) ?? emptyScope();
    const qualifier = left.table?.table.identifier.name;
    const tables = qualifier
      ? [scope.get(qualifier)?.table]
      : [...scope.values()]
          .map((entry) => entry.table)
          .filter((table) => tableInfo(table)?.columns.includes(column));
    if (tables.length !== 1 || !isTimestampColumn(tables[0], column)) {
      return transformed;
    }
    const right = timestampValue(transformed.rightOperand);
    return right === transformed.rightOperand
      ? transformed
      : Object.freeze({ ...transformed, rightOperand: right });
  }

  protected override transformCast(node: CastNode, queryId?: QueryId): CastNode {
    const transformed = super.transformCast(node, queryId);
    const dataType = transformed.dataType as DataTypeNode;
    const mapped = dataType.kind === 'DataTypeNode' ? CAST_TYPES[String(dataType.dataType)] : undefined;
    return mapped ? Object.freeze({ ...transformed, dataType: RawNode.createWithSql(mapped) }) : transformed;
  }

  protected override transformSelectModifier(
    node: SelectModifierNode,
    queryId?: QueryId,
  ): SelectModifierNode {
    const transformed = super.transformSelectModifier(node, queryId);
    const mapped = transformed.modifier ? ROW_LOCKS[transformed.modifier] : undefined;
    return mapped
      ? Object.freeze({ ...transformed, modifier: mapped as SelectModifierNode['modifier'] })
      : transformed;
  }
}

export class MysqlPlugin implements KyselyPlugin {
  readonly #markers = new WeakMap<QueryId, ReadonlyMap<string, ResultType>>();

  transformQuery({ node, queryId }: PluginTransformQueryArgs): RootOperationNode {
    const markers = collectMarkers(node);
    if (markers) {
      this.#markers.set(queryId, markers);
    }
    return new MysqlTransformer().transformNode(node, queryId);
  }

  /** Decodes columns marked with a result type (MySQL computes `a is not null` as an integer). */
  async transformResult({ result, queryId }: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const markers = this.#markers.get(queryId);
    if (!markers || result.rows.length === 0) {
      return result;
    }
    return { ...result, rows: result.rows.map((row) => decodeRow(row, markers)) };
  }
}
