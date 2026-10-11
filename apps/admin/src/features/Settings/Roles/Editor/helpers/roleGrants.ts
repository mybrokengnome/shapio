import {
  CONTENT_ACTIONS,
  type ContentAction,
  type PermissionAction,
  type RoleKind,
  type RolePermission,
} from '@shapio/client';
import { CHECKBOX_ACTIONS_BY_KIND, MATRIX_RULES_BY_KIND } from '../../constants';
import {
  toMatrix,
  toPermissions,
  type MatrixPermission,
  type PermissionMatrix,
} from '../../PermissionMatrix/helpers/permissionMatrix';

/** A role's grants as its editor shows them. */
export type RoleGrants = {
  /** Content actions per model (or every model). */
  matrix: PermissionMatrix<ContentAction>;
  /** Every-model checkboxes: instance actions, or read drafts. */
  actions: PermissionAction[];
  /** Anything else, kept as loaded (the server allows nothing else today). */
  others: RolePermission[];
};

const isContentGrant = (permission: RolePermission): permission is MatrixPermission<ContentAction> =>
  (CONTENT_ACTIONS as readonly string[]).includes(permission.action);

const isCheckboxGrant = (kind: RoleKind, permission: RolePermission) =>
  (CHECKBOX_ACTIONS_BY_KIND[kind] as readonly PermissionAction[]).includes(permission.action) &&
  permission.modelId === null &&
  permission.condition === null &&
  permission.fieldIds === null;

/** Splits a role's grants into the matrix, the checkboxes, and the rest. Nothing is dropped. */
export const splitGrants = (kind: RoleKind, permissions: readonly RolePermission[]): RoleGrants => {
  const actions = MATRIX_RULES_BY_KIND[kind].actions;
  const inMatrix = permissions.filter(
    (permission): permission is MatrixPermission<ContentAction> =>
      isContentGrant(permission) && actions.includes(permission.action),
  );
  return {
    matrix: toMatrix(inMatrix),
    actions: permissions.filter((permission) => isCheckboxGrant(kind, permission)).map((p) => p.action),
    others: permissions.filter(
      (permission) =>
        !inMatrix.includes(permission as MatrixPermission<ContentAction>) &&
        !isCheckboxGrant(kind, permission),
    ),
  };
};

/** The full grant list to save: matrix grants in a stable order, then the checkboxes, then the rest. */
export const joinGrants = (kind: RoleKind, grants: RoleGrants): RolePermission[] => {
  const checkboxActions: readonly PermissionAction[] = CHECKBOX_ACTIONS_BY_KIND[kind];
  return [
    ...toPermissions(grants.matrix, MATRIX_RULES_BY_KIND[kind]),
    ...checkboxActions
      .filter((action) => grants.actions.includes(action))
      .map((action) => ({ action, modelId: null, condition: null, fieldIds: null })),
    ...grants.others,
  ];
};
