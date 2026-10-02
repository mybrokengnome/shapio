import type { FieldDefinition } from '@shapio/schema';
import { sql, type RawBuilder } from 'kysely';
import { AppError } from '../../helpers/appError.js';
import type { FieldMask, Policy, Principal, RowFilter } from '../../permissions/types.js';

/**
 * Policies in content queries (ADR 0005): row filters compile to SQL here (and only here); masks decide
 * which fields a caller sees, may filter on and may write. Row-filter conditions are an enumerated set,
 * never free-form expressions.
 */

/** Entry columns row conditions read. `e` is the entries alias of every head query. */
const OWNER_COLUMNS = { admin: 'e.created_by_admin_id', appUser: 'e.owner_app_user_id' } as const;

export const compileRowFilter = (
  filter: RowFilter | null,
  principal: Principal,
): RawBuilder<unknown> | null => {
  if (!filter) {
    return null;
  }
  switch (filter.kind) {
    case 'ownedByPrincipal':
      if (principal.kind === 'admin') {
        return sql`${sql.ref(OWNER_COLUMNS.admin)} = ${principal.adminUserId}::uuid`;
      }
      if (principal.kind === 'appUser') {
        return sql`${sql.ref(OWNER_COLUMNS.appUser)} = ${principal.appUserId}::uuid`;
      }
      // Tokens and anonymous callers own nothing.
      return sql`false`;
    case 'and':
    case 'or': {
      const parts = filter.filters.map((child) => compileRowFilter(child, principal) ?? sql`true`);
      if (parts.length === 0) {
        return sql`${filter.kind === 'and'}::boolean`;
      }
      return sql`(${sql.join(parts, filter.kind === 'and' ? sql` and ` : sql` or `)})`;
    }
  }
};

export type EntryOwnership = { created_by_admin_id: string | null; owner_app_user_id: string | null };

/** The same row filter evaluated on one loaded entry (writes check it before touching the entry). */
export const matchesRowFilter = (
  filter: RowFilter | null,
  principal: Principal,
  entry: EntryOwnership,
): boolean => {
  if (!filter) {
    return true;
  }
  switch (filter.kind) {
    case 'ownedByPrincipal':
      return (
        (principal.kind === 'admin' && entry.created_by_admin_id === principal.adminUserId) ||
        (principal.kind === 'appUser' && entry.owner_app_user_id === principal.appUserId)
      );
    case 'and':
      return filter.filters.every((child) => matchesRowFilter(child, principal, entry));
    case 'or':
      return filter.filters.some((child) => matchesRowFilter(child, principal, entry));
  }
};

/**
 * Whether a mask lets the caller see a field. A wildcard mask covers every live field; deprecated fields
 * stay hidden unless a mask names them explicitly.
 */
export const maskAllows = (mask: FieldMask, field: FieldDefinition): boolean =>
  mask.mode === 'all' ? !field.deprecated : mask.fieldIds.includes(field.id);

export const forbidden = (message: string, details?: Record<string, unknown>) =>
  new AppError(403, 'FORBIDDEN', message, details);

/** Throws 403 unless the policy allows the action. */
export const assertAllowed = (policy: Policy, what: string): void => {
  if (!policy.allowed) {
    throw forbidden(`Your role does not allow ${what}`);
  }
};

/** Writes may only touch fields in the write mask (ADR 0005: 403, never a silent drop). */
export const assertWritable = (
  mask: FieldMask,
  fields: readonly FieldDefinition[],
  fieldIds: Iterable<string>,
) => {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const denied = [...fieldIds].filter((id) => {
    const field = byId.get(id);
    return field !== undefined && !maskAllows(mask, field);
  });
  if (denied.length > 0) {
    throw new AppError(403, 'FORBIDDEN_FIELD', 'Your role may not change some of these fields', {
      fields: denied.map((id) => byId.get(id)?.apiKey ?? id),
    });
  }
};

/**
 * One condition over the entries row `e` for reads spanning several models (the snapshot diff): an entry
 * passes when its model is readable without a row filter, or its model's row filter holds for it.
 */
export const compileModelRowFilters = (
  models: ReadonlyArray<{ modelId: string; rowFilter: RowFilter | null }>,
  principal: Principal,
): RawBuilder<unknown> | null => {
  if (models.every((model) => model.rowFilter === null)) {
    return null;
  }
  const open = models.filter((model) => model.rowFilter === null).map((model) => model.modelId);
  const parts = [
    ...(open.length > 0 ? [sql`e.model_id = any(${open}::uuid[])`] : []),
    ...models.flatMap((model) =>
      model.rowFilter === null
        ? []
        : [
            sql`(e.model_id = ${model.modelId}::uuid and ${compileRowFilter(model.rowFilter, principal) ?? sql`true`})`,
          ],
    ),
  ];
  return sql`(${sql.join(parts, sql` or `)})`;
};
