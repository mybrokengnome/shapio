import { APP_CONTENT_ACTIONS, type AppContentAction } from '@shapio/client';

export { APP_CONTENT_ACTIONS };

/** The matrix row that grants on every model, including models created later (`modelId: null`). */
export const ALL_MODELS = '*';

/** Actions a row filter means something for: "only entries the app user owns". */
export const OWN_ONLY_ACTIONS: ReadonlySet<AppContentAction> = new Set([
  'read',
  'update',
  'delete',
  'publish',
]);

/** Actions a field list applies to (what the user may see or write). */
export const FIELD_SCOPED_ACTIONS: ReadonlySet<AppContentAction> = new Set(['read', 'create', 'update']);

/** Column headings: short verbs. */
export const ACTION_COLUMN_KEYS = {
  read: 'appRoles.actions.read',
  create: 'appRoles.actions.create',
  update: 'appRoles.actions.update',
  delete: 'appRoles.actions.delete',
  publish: 'appRoles.actions.publish',
} as const satisfies Record<AppContentAction, string>;
