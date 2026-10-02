import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as appRolesRepository from '../repositories/appRoles.js';
import * as permissionsVersionRepository from '../repositories/permissionsVersion.js';
import type { Grant } from './policy.js';
import { CONTENT_ACTIONS, GLOBAL_ACTIONS, type ContentAction, type GlobalAction } from './types.js';

/** Where the evaluator gets grants from. The database-backed cache in production, a fixed list in unit tests. */
export type GrantSource = {
  getGrants: (roleIds: readonly string[]) => Promise<readonly Grant[]>;
};

type Snapshot = { version: number; byRole: ReadonlyMap<string, readonly Grant[]> };

const KNOWN_ACTIONS: ReadonlySet<string> = new Set([...CONTENT_ACTIONS, ...GLOBAL_ACTIONS]);

const toGrant = (row: adminRolesRepository.PermissionGrantRow): Grant | undefined => {
  // Rows written by a newer Shapio may name actions this build does not know; they grant nothing here.
  if (!KNOWN_ACTIONS.has(row.action)) {
    return undefined;
  }
  return {
    roleId: row.role_id,
    action: row.action as ContentAction | GlobalAction,
    modelId: row.model_id,
    condition: row.condition === 'ownedByPrincipal' ? 'ownedByPrincipal' : null,
    fieldIds: row.field_ids,
  };
};

const groupByRole = (grants: readonly Grant[]): Map<string, Grant[]> => {
  const byRole = new Map<string, Grant[]>();
  for (const grant of grants) {
    const list = byRole.get(grant.roleId) ?? [];
    list.push(grant);
    byRole.set(grant.roleId, list);
  }
  return byRole;
};

/**
 * Every role's grants, held in memory and reloaded when `system_versions.permissions_version` moves.
 * The version is read on every lookup: that durable check is what makes a permission change visible to
 * every instance at once (NOTIFY would only be an optimisation). Concurrent reloads share one query.
 */
export const createPermissionCache = (database: Kysely<DB>): GrantSource => {
  let snapshot: Snapshot | undefined;
  let reloading: Promise<Snapshot> | undefined;

  const reload = async (version: number): Promise<Snapshot> => {
    // Read after the version: grants are at least as new as the version they are filed under, and a
    // change that commits in between bumps the version again, so the next lookup reloads.
    // Admin and app role IDs are distinct UUIDs; principals only ever carry roles of their own kind.
    const rows = [
      ...(await adminRolesRepository.listAllPermissions(database)),
      ...(await appRolesRepository.listAllPermissions(database)),
    ];
    const grants = rows.map(toGrant).filter((grant): grant is Grant => grant !== undefined);
    return { version, byRole: groupByRole(grants) };
  };

  const current = async (): Promise<Snapshot> => {
    const version = await permissionsVersionRepository.getPermissionsVersion(database);
    if (snapshot && snapshot.version === version) {
      return snapshot;
    }
    reloading ??= reload(version).finally(() => {
      reloading = undefined;
    });
    const loaded = await reloading;
    if (!snapshot || loaded.version >= snapshot.version) {
      snapshot = loaded;
    }
    return loaded;
  };

  return {
    getGrants: async (roleIds) => {
      if (roleIds.length === 0) {
        return [];
      }
      const { byRole } = await current();
      return roleIds.flatMap((roleId) => byRole.get(roleId) ?? []);
    },
  };
};
