import type { AppContentAction, AppRolePermission } from '@shapio/client';
import { ALL_MODELS, APP_CONTENT_ACTIONS, FIELD_SCOPED_ACTIONS, OWN_ONLY_ACTIONS } from '../constants';

/**
 * The permission matrix the editor works on: model (or every model) × action → grant options. It converts
 * losslessly to and from the API's grant list, so grants the editor does not show are never dropped.
 */
export type ActionGrant = {
  /** `ownedByPrincipal`: only entries the app user created. */
  ownOnly: boolean;
  /** `null` = every public field; otherwise exactly these field IDs (non-public ones included). */
  fieldIds: string[] | null;
};

export type ModelGrants = Partial<Record<AppContentAction, ActionGrant>>;

/** Keyed by model ID, or `ALL_MODELS`. */
export type PermissionMatrix = Readonly<Record<string, ModelGrants>>;

export const toMatrix = (permissions: readonly AppRolePermission[]): PermissionMatrix => {
  const matrix: Record<string, ModelGrants> = {};
  for (const permission of permissions) {
    const key = permission.modelId ?? ALL_MODELS;
    matrix[key] = {
      ...matrix[key],
      [permission.action]: {
        ownOnly: permission.condition === 'ownedByPrincipal',
        fieldIds: permission.fieldIds === null ? null : [...permission.fieldIds].sort(),
      },
    };
  }
  return matrix;
};

/** Grants in a stable order (every-model row first, then by model ID and action), so dirty checks compare. */
export const toPermissions = (matrix: PermissionMatrix): AppRolePermission[] =>
  Object.keys(matrix)
    .sort((a, b) => (a === ALL_MODELS ? -1 : b === ALL_MODELS ? 1 : a.localeCompare(b)))
    .flatMap((key) =>
      APP_CONTENT_ACTIONS.flatMap((action) => {
        const grant = matrix[key]?.[action];
        if (!grant) {
          return [];
        }
        return [
          {
            action,
            modelId: key === ALL_MODELS ? null : key,
            condition: grant.ownOnly && OWN_ONLY_ACTIONS.has(action) ? ('ownedByPrincipal' as const) : null,
            fieldIds: FIELD_SCOPED_ACTIONS.has(action) ? grant.fieldIds : null,
          },
        ];
      }),
    );

const withGrant = (
  matrix: PermissionMatrix,
  key: string,
  action: AppContentAction,
  grant: ActionGrant | undefined,
): PermissionMatrix => {
  const row: ModelGrants = { ...matrix[key] };
  if (grant) {
    row[action] = grant;
  } else {
    delete row[action];
  }
  return { ...matrix, [key]: row };
};

export const setGranted = (
  matrix: PermissionMatrix,
  key: string,
  action: AppContentAction,
  granted: boolean,
): PermissionMatrix =>
  withGrant(
    matrix,
    key,
    action,
    granted ? (matrix[key]?.[action] ?? { ownOnly: false, fieldIds: null }) : undefined,
  );

export const updateGrant = (
  matrix: PermissionMatrix,
  key: string,
  action: AppContentAction,
  changes: Partial<ActionGrant>,
): PermissionMatrix => {
  const current = matrix[key]?.[action];
  return current ? withGrant(matrix, key, action, { ...current, ...changes }) : matrix;
};

/** Whether a row has any granted action with options to set (own entries, or fields on a model row). */
export const hasOptions = (key: string, grants: ModelGrants | undefined): boolean =>
  APP_CONTENT_ACTIONS.some(
    (action) =>
      grants?.[action] !== undefined &&
      (OWN_ONLY_ACTIONS.has(action) || (key !== ALL_MODELS && FIELD_SCOPED_ACTIONS.has(action))),
  );

/** Grants or revokes one action on every given row (a column's header checkbox). Granted rows keep options. */
export const setColumn = (
  matrix: PermissionMatrix,
  keys: readonly string[],
  action: AppContentAction,
  granted: boolean,
): PermissionMatrix => keys.reduce((next, key) => setGranted(next, key, action, granted), matrix);

/** A column header checkbox: every row holds the action (true), some do ('indeterminate'), or none (false). */
export const columnState = (
  matrix: PermissionMatrix,
  keys: readonly string[],
  action: AppContentAction,
): boolean | 'indeterminate' => {
  const granted = keys.filter((key) => matrix[key]?.[action] !== undefined).length;
  if (granted === 0) {
    return false;
  }
  return granted === keys.length ? true : 'indeterminate';
};
