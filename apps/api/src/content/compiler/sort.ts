import type { FieldDefinition, InterfaceDefinition, ModelDefinition } from '@shapio/schema';
import { sql } from 'kysely';
import { contentDialect } from './currentDialect.js';
import type { ContentSqlDialect } from './dialect/types.js';
import { fieldValueExpression } from './expressions.js';
import { isSortable } from './operators.js';
import type { OrderTerm, SortTerm } from './types.js';

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

const termOf = (term: SortTerm, dialect: ContentSqlDialect): OrderTerm => ({
  expression:
    term.target.kind === 'system'
      ? sql.ref(SYSTEM_SORT_COLUMNS[term.target.name])
      : fieldValueExpression(term.target.field.id, term.target.field.type, dialect),
  direction: term.direction,
  // System columns are never null; field values may be missing.
  nullable: term.target.kind === 'field',
});

export const defaultSortTerms = (
  model: Pick<ModelDefinition | InterfaceDefinition, 'fields' | 'display'>,
  isReadable: (field: FieldDefinition) => boolean,
): SortTerm[] => {
  const preferred = model.display.defaultSort;
  const field = preferred ? model.fields.find((candidate) => candidate.id === preferred.fieldId) : undefined;
  if (preferred && field && !field.deprecated && isSortable(field) && isReadable(field)) {
    return [{ target: { kind: 'field', field }, direction: preferred.direction }];
  }
  return [{ target: { kind: 'system', name: 'createdAt' }, direction: 'desc' }];
};

/**
 * The ORDER BY of a head query, as terms the compiler renders (`compile.ts`): a family read orders each arm by
 * them and the union by their projected aliases.
 */
export const compileOrderBy = (
  terms: readonly SortTerm[],
  dialect: ContentSqlDialect = contentDialect(),
): OrderTerm[] => [
  ...terms.map((term) => termOf(term, dialect)),
  { expression: sql`h.entry_id`, direction: 'asc', nullable: false },
];
