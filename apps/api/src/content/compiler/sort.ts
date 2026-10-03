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
 * the model's default sort applies when the caller may read that field, else newest first.
 */
const SYSTEM_SORT_COLUMNS = {
  id: 'h.entry_id',
  createdAt: 'e.created_at',
  updatedAt: 'h.updated_at',
} as const;

const termSql = (term: SortTerm, dialect: ContentSqlDialect): RawBuilder<unknown> => {
  // System columns are never null; field values may be missing.
  const direction = dialect.sortDirection(term.direction, term.target.kind === 'field');
  const expression =
    term.target.kind === 'system'
      ? sql.ref(SYSTEM_SORT_COLUMNS[term.target.name])
      : fieldValueExpression(term.target.field.id, term.target.field.type, dialect);
  return sql`${expression} ${direction}`;
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
