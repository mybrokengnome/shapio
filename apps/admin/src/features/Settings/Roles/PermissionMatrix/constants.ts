import type { ContentAction } from '@shapio/client';

/** The matrix row that grants on every model, including models created later (`modelId: null`). */
export const ALL_MODELS = '*';

/** Column headings: short verbs. */
export const ACTION_COLUMN_KEYS = {
  read: 'roles.matrix.actions.read',
  create: 'roles.matrix.actions.create',
  update: 'roles.matrix.actions.update',
  delete: 'roles.matrix.actions.delete',
  publish: 'roles.matrix.actions.publish',
  schemaManage: 'roles.matrix.actions.schemaManage',
} as const satisfies Record<ContentAction, string>;
