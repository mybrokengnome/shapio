import {
  ColumnNode,
  ColumnUpdateNode,
  OnDuplicateKeyNode,
  ReferenceNode,
  TableNode,
  ValuesNode,
  type InsertQueryNode,
  type OnConflictNode,
} from 'kysely';
import { tableInfo } from './tables.js';

/** The alias the compiler gives the inserted row in `ON DUPLICATE KEY UPDATE` (PostgreSQL's `excluded`). */
export const EXCLUDED_ALIAS = 'excluded';

export const sameColumns = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((column) => b.includes(column));

/**
 * Whether `ON DUPLICATE KEY` (which fires on any unique key) behaves like `ON CONFLICT (target)` for this
 * insert: every other unique key of the table is made of columns generated for this insert (fresh UUIDs),
 * so it cannot collide. An untargeted conflict (`ON CONFLICT DO NOTHING`) matches any key, like MySQL.
 */
export const duplicateKeyMatchesTarget = (
  table: string,
  target: readonly string[] | undefined,
  supplied: readonly string[],
): boolean => {
  const info = tableInfo(table);
  if (!info) {
    return false;
  }
  if (target === undefined) {
    return true;
  }
  const generated = info.generated ?? {};
  return info.uniqueKeys.every(
    (key) =>
      sameColumns(key.columns, target) ||
      key.columns.every((column) => generated[column] === 'uuid' && !supplied.includes(column)),
  );
};

/**
 * Tables whose rows a trigger keeps immutable (the baseline's `*_no_update` triggers): a no-op
 * `ON DUPLICATE KEY UPDATE` is still an UPDATE there, so their `DO NOTHING` goes through the plan.
 */
const REFUSES_UPDATES: ReadonlySet<string> = new Set(['content_revisions', 'schema_revisions']);

const targetOf = (conflict: OnConflictNode): readonly string[] | undefined =>
  conflict.columns?.map((column) => column.column.name);

/**
 * `ON CONFLICT … DO UPDATE` as `ON DUPLICATE KEY UPDATE`, and `ON CONFLICT … DO NOTHING` without RETURNING
 * as `ON DUPLICATE KEY UPDATE <key> = <key>` (a no-op), when MySQL's any-key behaviour equals the target's
 * (`duplicateKeyMatchesTarget`). Any other conflict clause (another unique key could fire, a `WHERE` on the
 * update, RETURNING) is left for the compiler's plan: each row inserted under a savepoint, and a duplicate
 * on the target either skipped or turned into an UPDATE of the row it found.
 */
export const toOnDuplicateKey = (
  node: InsertQueryNode,
  conflict: OnConflictNode,
  table: string,
): InsertQueryNode => {
  const target = targetOf(conflict);
  const supplied = node.columns?.map((column) => column.column.name) ?? [];
  const matches = duplicateKeyMatchesTarget(table, target, supplied);
  if (conflict.doNothing) {
    if (node.returning || !matches || REFUSES_UPDATES.has(table)) {
      return node;
    }
    const column = target?.[0] ?? tableInfo(table)!.primaryKey[0]!;
    // Qualified: the `excluded` row alias has the same column names.
    const self = ReferenceNode.create(ColumnNode.create(column), TableNode.create(table));
    return Object.freeze({
      ...node,
      onConflict: undefined,
      onDuplicateKey: OnDuplicateKeyNode.create([ColumnUpdateNode.create(ColumnNode.create(column), self)]),
    });
  }
  if (conflict.constraint || conflict.indexExpression) {
    throw new Error(`MySQL: ON CONFLICT on ${table} needs a column target`);
  }
  if (conflict.updateWhere || !matches || node.returning || !node.values || !ValuesNode.is(node.values)) {
    // The statement plan runs it row by row: insert, or update the row the target found (`plans.ts`).
    return node;
  }
  return Object.freeze({
    ...node,
    onConflict: undefined,
    onDuplicateKey: OnDuplicateKeyNode.create(conflict.updates ?? []),
  });
};
