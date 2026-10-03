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
 * the model's default sort applies when the caller may read that field, else newest first. The tie-breaker is
 * spelled `e.id` (equal to `h.entry_id` by the join) so that, on an unfiltered list in `created_at` order,
 * every ORDER BY term is on `entries` and MySQL sorts only the model's entries before joining their heads.
 */
const SYSTEM_SORT_COLUMNS = {
  id: 'h.entry_id',
  createdAt: 'e.created_at',
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

/** Whether the first sort term is a column of `entries` (the head query's `e`), not of the head. */
export const leadsWithEntryColumn = (terms: readonly SortTerm[]): boolean =>
  terms[0]?.target.kind === 'system' && SYSTEM_SORT_COLUMNS[terms[0].target.name].startsWith('e.');

export const compileOrderBy = (
  terms: readonly SortTerm[],
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown>[] => [...terms.map((term) => termSql(term, dialect)), sql`e.id asc`];
