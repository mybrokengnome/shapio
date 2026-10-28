import {
  CONTENT_ACTIONS,
  GLOBAL_ACTIONS,
  type ContentAction,
  type PermissionAction,
  type RoleKind,
} from '@shapio/client';
import type { MatrixRules } from './PermissionMatrix/helpers/permissionMatrix';

export { GLOBAL_ACTIONS };

/**
 * The permission matrix per role kind. Admin roles: every content action per model, "own entries" (entries
 * the admin created) and field lists where they mean something. Delivery roles: read per model, with field
 * lists (tokens own no entries).
 */
export const MATRIX_RULES_BY_KIND: Record<RoleKind, MatrixRules<ContentAction>> = {
  admin: {
    actions: CONTENT_ACTIONS,
    ownOnlyActions: new Set<ContentAction>(['read', 'update', 'delete', 'publish']),
    fieldScopedActions: new Set<ContentAction>(['read', 'create', 'update']),
  },
  delivery: {
    actions: ['read'],
    ownOnlyActions: new Set<ContentAction>(),
    fieldScopedActions: new Set<ContentAction>(['read']),
  },
};

/** The every-model checkboxes per role kind: instance actions; read drafts (delivery roles only). */
export const CHECKBOX_ACTIONS_BY_KIND = {
  admin: GLOBAL_ACTIONS,
  delivery: ['readDrafts'],
} as const satisfies Record<RoleKind, readonly PermissionAction[]>;

/** Translation keys per action (action names contain dots, which i18next reads as nesting). */
export const ACTION_LABEL_KEYS = {
  read: 'roles.actions.read',
  readDrafts: 'roles.actions.readDrafts',
  create: 'roles.actions.create',
  update: 'roles.actions.update',
  delete: 'roles.actions.delete',
  publish: 'roles.actions.publish',
  schemaManage: 'roles.actions.schemaManage',
  'schema.create': 'roles.actions.schemaCreate',
  'users.manage': 'roles.actions.usersManage',
  'roles.manage': 'roles.actions.rolesManage',
  'tokens.manage': 'roles.actions.tokensManage',
  'audit.read': 'roles.actions.auditRead',
  'sites.manage': 'roles.actions.sitesManage',
  'media.read': 'roles.actions.mediaRead',
  'media.write': 'roles.actions.mediaWrite',
  'media.manage': 'roles.actions.mediaManage',
  'publishing.manage': 'roles.actions.publishingManage',
  'webhooks.manage': 'roles.actions.webhooksManage',
  'deployments.manage': 'roles.actions.deploymentsManage',
  'deployments.trigger': 'roles.actions.deploymentsTrigger',
  'changes.manage': 'roles.actions.changesManage',
  'changes.ship': 'roles.actions.changesShip',
  'changes.approve': 'roles.actions.changesApprove',
  'site.settings': 'roles.actions.siteSettings',
} as const satisfies Record<PermissionAction, string>;

export const ROLE_KINDS: readonly RoleKind[] = ['admin', 'delivery'];

/** Same rule as the server (admin_roles.key check constraint). */
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
