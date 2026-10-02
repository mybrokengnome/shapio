import type { AppRoleRecord } from './format.js';

/** A stored grant row (app roles and admin/delivery roles share the shape). */
type GrantRow = {
  action: string;
  model_id: string | null;
  condition: string | null;
  field_ids: string[] | null;
};

type Grant = AppRoleRecord['permissions'][number];

const grantKey = (grant: Grant) =>
  JSON.stringify([
    grant.action,
    grant.modelId,
    grant.condition,
    grant.fieldIds ? [...grant.fieldIds].sort() : null,
  ]);

export const toGrant = (row: GrantRow): Grant => ({
  action: row.action,
  modelId: row.model_id,
  condition: row.condition === 'ownedByPrincipal' ? 'ownedByPrincipal' : null,
  fieldIds: row.field_ids,
});

/** Whether a stored app role grants exactly the bundle's permissions (order-insensitive). */
export const samePermissions = (stored: readonly GrantRow[], bundle: readonly Grant[]) => {
  const left = stored.map((row) => grantKey(toGrant(row))).sort();
  const right = bundle.map(grantKey).sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
};
