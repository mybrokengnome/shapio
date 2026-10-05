import { CONTENT_ACTIONS, GLOBAL_ACTIONS, type PermissionAction, type RoleKind } from '@shapio/client';

export { CONTENT_ACTIONS, GLOBAL_ACTIONS };

/** Every action this form edits. Content grants made here apply to every model (`modelId: null`). */
export const EDITABLE_ACTIONS: readonly PermissionAction[] = [...CONTENT_ACTIONS, ...GLOBAL_ACTIONS];

/** Translation keys per action (action names contain dots, which i18next reads as nesting). */
export const ACTION_LABEL_KEYS = {
  read: 'roles.actions.read',
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
  'site.settings': 'roles.actions.siteSettings',
} as const satisfies Record<PermissionAction, string>;

export const ROLE_KINDS: readonly RoleKind[] = ['admin', 'delivery'];

/** Same rule as the server (admin_roles.key check constraint). */
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
