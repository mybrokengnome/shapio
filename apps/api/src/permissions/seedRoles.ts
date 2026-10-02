import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as permissionsVersionRepository from '../repositories/permissionsVersion.js';
import { CONTENT_ACTIONS, GLOBAL_ACTIONS, type ContentAction, type GlobalAction } from './types.js';

export const SYSTEM_ROLE_KEYS = {
  owner: 'owner',
  admin: 'admin',
  editor: 'editor',
  readOnly: 'read-only',
} as const;

type SystemRoleDefinition = {
  key: string;
  name: string;
  description: string;
  /** Granted on every model (model_id null), every field. */
  contentActions: readonly ContentAction[];
  globalActions: readonly GlobalAction[];
};

/**
 * Built-in roles. They cannot be edited or deleted; custom roles cover everything else. `admin` differs
 * from `owner` only in what the services allow around the owner role (only owners grant or remove it).
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: SYSTEM_ROLE_KEYS.owner,
    name: 'Owner',
    description: 'Full access, including managing owners.',
    contentActions: CONTENT_ACTIONS,
    globalActions: GLOBAL_ACTIONS,
  },
  {
    key: SYSTEM_ROLE_KEYS.admin,
    name: 'Admin',
    description: 'Full access to content, models, users, roles and tokens. Cannot manage owners.',
    contentActions: CONTENT_ACTIONS,
    globalActions: GLOBAL_ACTIONS,
  },
  {
    key: SYSTEM_ROLE_KEYS.editor,
    name: 'Editor',
    description: 'Creates, edits, publishes and deletes content in every model.',
    contentActions: ['read', 'create', 'update', 'delete', 'publish'],
    // Editors group publications into change sets and (re)trigger site builds; webhooks, deployment
    // connections and the jobs view stay with admins.
    globalActions: ['media.read', 'media.write', 'changes.manage', 'deployments.trigger'],
  },
  {
    key: SYSTEM_ROLE_KEYS.readOnly,
    name: 'Read-only',
    description: 'Reads all content, changes nothing.',
    contentActions: ['read'],
    globalActions: ['media.read'],
  },
];

/**
 * Creates any missing built-in role and grant. Idempotent and safe to run from several instances at once
 * (conflicts are ignored); bumps the permissions version only when something was added. Runs at startup
 * and before `shapio admin create`.
 */
export const ensureSystemRoles = async (database: Kysely<DB>): Promise<void> => {
  await database.transaction().execute(async (trx) => {
    let changed = false;
    for (const definition of SYSTEM_ROLES) {
      const inserted = await adminRolesRepository.insertIfAbsent(
        {
          key: definition.key,
          name: definition.name,
          description: definition.description,
          kind: 'admin',
          is_system: true,
        },
        trx,
      );
      changed ||= inserted !== undefined;
      const [role] = await adminRolesRepository.findByKeys([definition.key], trx);
      if (!role) {
        throw new Error(`System role ${definition.key} is missing after insert`);
      }
      const actions = [...definition.contentActions, ...definition.globalActions];
      const added = await adminRolesRepository.insertPermissionsIfAbsent(
        actions.map((action) => ({
          role_id: role.id,
          action,
          model_id: null,
          condition: null,
          field_ids: null,
        })),
        trx,
      );
      changed ||= added.length > 0;
    }
    if (changed) {
      await permissionsVersionRepository.bumpPermissionsVersion(trx);
    }
  });
};
