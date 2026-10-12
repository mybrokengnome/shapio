import { APP_CONTENT_ACTIONS, type AppContentAction } from '@shapio/client';
import type { MatrixRules } from '../PermissionMatrix/helpers/permissionMatrix';

/** What an app role's matrix edits: content actions; "own entries" and field lists where they mean something. */
export const APP_ROLE_MATRIX_RULES: MatrixRules<AppContentAction> = {
  actions: APP_CONTENT_ACTIONS,
  ownOnlyActions: new Set(['read', 'update', 'delete', 'publish']),
  fieldScopedActions: new Set(['read', 'create', 'update']),
};
