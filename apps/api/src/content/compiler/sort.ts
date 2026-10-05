import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import { sql, type RawBuilder } from 'kysely';
import { contentDialect } from './currentDialect.js';
import type { ContentSqlDialect } from './dialect/types.js';
import { fieldValueExpression } from './expressions.js';
import { isSortable } from './operators.js';
import type { SortTerm } from './types.js';

/**
 * ORDER BY for a content query. Field sorts use the same expression as the field's index (so the index can
 * serve them); the entry ID is always the final tie-breaker so pages are stable. Without an explicit sort
 * the model's default sort applies when the caller may read that field, else newest first. `createdAt` is the
 * entry's creation time copied on the head (`h.entry_created_at`), so the default order and its tie-breaker
 * are both head columns, which `entry_heads_entry_order_idx` (site, model, state, `entry_created_at desc`,
 * `entry_id`) serves: a page is read in index order and the scan stops at the limit (ADR 0001, "Delivery perf
 * 2").
 */
const SYSTEM_SORT_COLUMNS = {
  id: 'h.entry_id',
  createdAt: 'h.entry_created_at',
  updatedAt: 'h.updated_at',
} as const;

const termSql = (term: SortTerm, dialect: ContentSqlDialect): RawBuilder<unknown> => {
  // System columns are never null; field values may be missing.
  const nullable = term.target.kind === 'field';
  const expression =
    term.target.kind === 'system'
      ? sql.ref(SYSTEM_SORT_COLUMNS[term.target.name])
      : fieldValueExpression(term.target.field.id, term.target.field.type, dialect);
  if (dialect.sortTerm) {
    return dialect.sortTerm(expression, term.direction, nullable);
  }
  return sql`${expression} ${dialect.sortDirection(term.direction, nullable)}`;
};

export const defaultSortTerms = (
  model: ModelDefinition,
  isReadable: (field: FieldDefinition) => boolean,
): SortTerm[] => {
  const preferred = model.display.defaultSort;
  const field = preferred ? model.fields.find((candidate) => candidate.id === preferred.fieldId) : undefined;
  if (preferred && field && !field.deprecated && isSortable(field) && isReadable(field)) {
    return [{ target: { kind: 'field', field }, direction: preferred.direction }];
  }
  return [{ target: { kind: 'system', name: 'createdAt' }, direction: 'desc' }];
};

export const compileOrderBy = (
  terms: readonly SortTerm[],
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown>[] => [...terms.map((term) => termSql(term, dialect)), sql`h.entry_id asc`];
