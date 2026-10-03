import { randomUUID } from 'node:crypto';
import {
  ColumnNode,
  PrimitiveValueListNode,
  ValueListNode,
  ValueNode,
  ValuesNode,
  type InsertQueryNode,
  type OperationNode,
} from 'kysely';
import { toDatetimeText } from './codec.js';
import { SequenceValue } from './parameters.js';
import { tableInfo, type MysqlTableInfo } from './tables.js';

/**
 * Values MySQL needs written differently (ADR 0001, "MySQL"): columns PostgreSQL defaults that MySQL cannot
 * (UUIDs generated here, so a planned RETURNING knows the key; the change sequence), and ISO-8601 text bound
 * to timestamp columns.
 */

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * Text bound to a timestamp column, as UTC `DATETIME` text: PostgreSQL reads ISO-8601 with a zone
 * (`…T…Z`, `+02:00`); MySQL would reject it or ignore the zone.
 */
const timestampText = (value: unknown): unknown =>
  typeof value === 'string' && ISO_TIMESTAMP.test(value) ? toDatetimeText(value) : value;

export const isTimestampColumn = (table: string | undefined, column: string): boolean =>
  table !== undefined && (tableInfo(table)?.timestamps ?? []).includes(column);

/** A value node (or primitive list) bound to a timestamp column, with ISO text normalised. */
export const timestampValue = (node: OperationNode): OperationNode => {
  if (ValueNode.is(node)) {
    const value = timestampText(node.value);
    return value === node.value ? node : ValueNode.create(value);
  }
  if (PrimitiveValueListNode.is(node)) {
    return PrimitiveValueListNode.create(node.values.map(timestampText));
  }
  return node;
};

/** Insert rows with ISO text for timestamp columns normalised. */
export const withTimestampValues = (node: InsertQueryNode): InsertQueryNode => {
  const table = node.into?.table.identifier.name;
  const columns = node.columns?.map((column) => column.column.name) ?? [];
  const positions = columns.flatMap((column, index) => (isTimestampColumn(table, column) ? [index] : []));
  if (positions.length === 0 || !node.values || !ValuesNode.is(node.values)) {
    return node;
  }
  const rows = node.values.values.map((row) =>
    PrimitiveValueListNode.is(row)
      ? PrimitiveValueListNode.create(
          row.values.map((value, index) => (positions.includes(index) ? timestampText(value) : value)),
        )
      : ValueListNode.create(
          row.values.map((value, index) => (positions.includes(index) ? timestampValue(value) : value)),
        ),
  );
  return Object.freeze({ ...node, values: ValuesNode.create(rows) });
};

/** A fresh value for a column PostgreSQL defaults. */
const generatedValue = (kind: string): unknown => (kind === 'uuid' ? randomUUID() : new SequenceValue(kind));

/** The insert with every generated column the statement leaves out filled in. */
export const withGeneratedColumns = (node: InsertQueryNode, info: MysqlTableInfo): InsertQueryNode => {
  const generated = Object.entries(info.generated ?? {});
  const columns = node.columns?.map((column) => column.column.name) ?? [];
  const missing = generated.filter(([column]) => !columns.includes(column));
  if (missing.length === 0 || !node.values || !ValuesNode.is(node.values) || !node.columns) {
    return node;
  }
  const rows = node.values.values.map((row) => {
    const extra = missing.map(([, kind]) => generatedValue(kind));
    return PrimitiveValueListNode.is(row)
      ? PrimitiveValueListNode.create([...row.values, ...extra])
      : ValueListNode.create([...row.values, ...extra.map((value) => ValueNode.create(value))]);
  });
  return Object.freeze({
    ...node,
    columns: [...node.columns, ...missing.map(([column]) => ColumnNode.create(column))],
    values: ValuesNode.create(rows),
  });
};
