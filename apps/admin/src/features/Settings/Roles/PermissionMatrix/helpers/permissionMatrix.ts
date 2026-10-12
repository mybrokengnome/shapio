import type { ContentAction, RoleCondition } from '@shapio/client';
import { ALL_MODELS } from '../constants';

/** One grant in the API's shape, for the content actions a matrix edits. */
export type MatrixPermission<A extends ContentAction> = {
  action: A;
  modelId: string | null;
  condition: RoleCondition | null;
  fieldIds: string[] | null;
};

/**
 * Which actions a matrix shows (its columns, in order), which take "only their own entries" (a row
 * filter), and which take a field list (what the holder may see or write).
 */
export type MatrixRules<A extends ContentAction> = {
  actions: readonly A[];
  ownOnlyActions: ReadonlySet<A>;
  fieldScopedActions: ReadonlySet<A>;
};

/**
 * The permission matrix an editor works on: model (or every model) × action → grant options. It converts
 * losslessly to and from the API's grant list, so grants the editor does not show are never dropped.
 */
export type ActionGrant = {
  /** `ownedByPrincipal`: only entries the holder created. */
  ownOnly: boolean;
  /** `null` = every field the holder's audience may see; otherwise exactly these field IDs. */
  fieldIds: string[] | null;
};

export type ModelGrants<A extends ContentAction> = Partial<Record<A, ActionGrant>>;

/** Keyed by model ID, or `ALL_MODELS`. */
export type PermissionMatrix<A extends ContentAction> = Readonly<Record<string, ModelGrants<A>>>;

export const toMatrix = <A extends ContentAction>(
  permissions: readonly MatrixPermission<A>[],
): PermissionMatrix<A> => {
  const matrix: Record<string, ModelGrants<A>> = {};
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
export const toPermissions = <A extends ContentAction>(
  matrix: PermissionMatrix<A>,
  rules: MatrixRules<A>,
): MatrixPermission<A>[] =>
  Object.keys(matrix)
    .sort((a, b) => (a === ALL_MODELS ? -1 : b === ALL_MODELS ? 1 : a.localeCompare(b)))
    .flatMap((key) =>
      rules.actions.flatMap((action) => {
        const grant = matrix[key]?.[action];
        if (!grant) {
          return [];
        }
        return [
          {
            action,
            modelId: key === ALL_MODELS ? null : key,
            condition:
              grant.ownOnly && rules.ownOnlyActions.has(action) ? ('ownedByPrincipal' as const) : null,
            fieldIds: rules.fieldScopedActions.has(action) ? grant.fieldIds : null,
          },
        ];
      }),
    );

const withGrant = <A extends ContentAction>(
  matrix: PermissionMatrix<A>,
  key: string,
  action: A,
  grant: ActionGrant | undefined,
): PermissionMatrix<A> => {
  const row: ModelGrants<A> = { ...matrix[key] };
  if (grant) {
    row[action] = grant;
  } else {
    delete row[action];
  }
  return { ...matrix, [key]: row };
};

export const setGranted = <A extends ContentAction>(
  matrix: PermissionMatrix<A>,
  key: string,
  action: A,
  granted: boolean,
): PermissionMatrix<A> =>
  withGrant(
    matrix,
    key,
    action,
    granted ? (matrix[key]?.[action] ?? { ownOnly: false, fieldIds: null }) : undefined,
  );

export const updateGrant = <A extends ContentAction>(
  matrix: PermissionMatrix<A>,
  key: string,
  action: A,
  changes: Partial<ActionGrant>,
): PermissionMatrix<A> => {
  const current = matrix[key]?.[action];
  return current ? withGrant(matrix, key, action, { ...current, ...changes }) : matrix;
};

/** Whether a row has any granted action with options to set (own entries, or fields on a model row). */
export const hasOptions = <A extends ContentAction>(
  key: string,
  grants: ModelGrants<A> | undefined,
  rules: MatrixRules<A>,
): boolean =>
  rules.actions.some(
    (action) =>
      grants?.[action] !== undefined &&
      (rules.ownOnlyActions.has(action) || (key !== ALL_MODELS && rules.fieldScopedActions.has(action))),
  );

/** Grants or revokes one action on every given row (a column's header checkbox). Granted rows keep options. */
export const setColumn = <A extends ContentAction>(
  matrix: PermissionMatrix<A>,
  keys: readonly string[],
  action: A,
  granted: boolean,
): PermissionMatrix<A> => keys.reduce((next, key) => setGranted(next, key, action, granted), matrix);

/** A column header checkbox: every row holds the action (true), some do ('indeterminate'), or none (false). */
export const columnState = <A extends ContentAction>(
  matrix: PermissionMatrix<A>,
  keys: readonly string[],
  action: A,
): boolean | 'indeterminate' => {
  const granted = keys.filter((key) => matrix[key]?.[action] !== undefined).length;
  if (granted === 0) {
    return false;
  }
  return granted === keys.length ? true : 'indeterminate';
};
