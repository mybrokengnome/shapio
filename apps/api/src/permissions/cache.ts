import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as appRolesRepository from '../repositories/appRoles.js';
import * as permissionsVersionRepository from '../repositories/permissionsVersion.js';
import * as siteAppRolesRepository from '../repositories/siteAppRoles.js';
import type { AppRoleAudience } from '../repositories/siteAppRoles.js';
import type { Grant } from './policy.js';
import {
  CONTENT_ACTIONS,
  GLOBAL_ACTIONS,
  type ContentAction,
  type GlobalAction,
  type PermissionExecutor,
} from './types.js';

/**
 * Where the evaluator gets grants from. The database-backed cache in production, a fixed list in unit tests.
 * `getSiteAppRoleIds`: the app roles a site binds to anonymous callers (`public`) or to every signed-in app
 * user (`authenticated`); a site that binds nothing grants them nothing (sites plan §H).
 */
export type GrantSource = {
  getGrants: (roleIds: readonly string[], executor?: PermissionExecutor) => Promise<readonly Grant[]>;
  getSiteAppRoleIds: (
    siteId: string,
    audience: AppRoleAudience,
    executor?: PermissionExecutor,
  ) => Promise<readonly string[]>;
};

type Snapshot = {
  version: number;
  byRole: ReadonlyMap<string, readonly Grant[]>;
  /** `<siteId>:<audience>` → bound app role IDs. */
  bindings: ReadonlyMap<string, readonly string[]>;
};

const bindingKey = (siteId: string, audience: string) => `${siteId}:${audience}`;

const groupBindings = (rows: readonly siteAppRolesRepository.SiteAppRoleBinding[]) => {
  const bindings = new Map<string, string[]>();
  for (const row of rows) {
    const key = bindingKey(row.site_id, row.audience);
    bindings.set(key, [...(bindings.get(key) ?? []), row.role_id]);
  }
  return bindings;
};

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
 * every instance at once (NOTIFY would only be an optimisation). Lookups on the pool share one reload; a
 * lookup inside a transaction reads (and, when stale, reloads) through that transaction alone, never
 * through a reload running on another request's transaction.
 */
export const createPermissionCache = (database: Kysely<DB>): GrantSource => {
  let snapshot: Snapshot | undefined;
  let reloading: Promise<Snapshot> | undefined;

  const reload = async (version: number, executor: PermissionExecutor): Promise<Snapshot> => {
    // Read after the version: grants are at least as new as the version they are filed under, and a
    // change that commits in between bumps the version again, so the next lookup reloads.
    // Admin and app role IDs are distinct UUIDs; principals only ever carry roles of their own kind.
    const rows = [
      ...(await adminRolesRepository.listAllPermissions(executor)),
      ...(await appRolesRepository.listAllPermissions(executor)),
    ];
    const grants = rows.map(toGrant).filter((grant): grant is Grant => grant !== undefined);
    const bindings = groupBindings(await siteAppRolesRepository.listAll(executor));
    return { version, byRole: groupByRole(grants), bindings };
  };

  const sharedReload = (version: number): Promise<Snapshot> =>
    (reloading ??= reload(version, database).finally(() => {
      reloading = undefined;
    }));

  const current = async (executor?: PermissionExecutor): Promise<Snapshot> => {
    const version = await permissionsVersionRepository.getPermissionsVersion(executor ?? database);
    if (snapshot && snapshot.version === version) {
      return snapshot;
    }
    const loaded = await (executor ? reload(version, executor) : sharedReload(version));
    if (!snapshot || loaded.version >= snapshot.version) {
      snapshot = loaded;
    }
    return loaded;
  };

  return {
    getGrants: async (roleIds, executor) => {
      if (roleIds.length === 0) {
        return [];
      }
      const { byRole } = await current(executor);
      return roleIds.flatMap((roleId) => byRole.get(roleId) ?? []);
    },
    getSiteAppRoleIds: async (siteId, audience, executor) => {
      const { bindings } = await current(executor);
      return bindings.get(bindingKey(siteId, audience)) ?? [];
    },
  };
};
