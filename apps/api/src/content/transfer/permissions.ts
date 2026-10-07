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

/** A role whose grants on unknown models were left out, and which models those were. */
export type DroppedGrants = { role: string; modelIds: string[] };

/**
 * Keeps the grants on all models (`modelId` null) or on a model in `knownModelIds`. A role that had grants
 * and keeps none is left out (`role` undefined): every grant it had was about models the other side lacks.
 * Roles are instance-wide, so one site's bundle would otherwise carry other sites' grants.
 */
export const keepKnownGrants = <Role extends { key: string; permissions: readonly Grant[] }>(
  role: Role,
  knownModelIds: ReadonlySet<string>,
): { role: Role | undefined; dropped: DroppedGrants | undefined } => {
  const known = (grant: Grant) => grant.modelId === null || knownModelIds.has(grant.modelId);
  const kept = role.permissions.filter(known);
  if (kept.length === role.permissions.length) {
    return { role, dropped: undefined };
  }
  const modelIds = [
    ...new Set(role.permissions.filter((grant) => !known(grant)).map((grant) => grant.modelId as string)),
  ];
  return {
    role: kept.length === 0 ? undefined : { ...role, permissions: kept },
    dropped: { role: role.key, modelIds },
  };
};
