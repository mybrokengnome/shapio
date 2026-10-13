import type { ContentAction, RoleCondition } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
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

/**
 * Whose field rules a matrix follows: admin roles see every field without a field list; app users and
 * delivery tokens only public ones (non-public fields only when a list names them).
 */
export type MatrixAudience = 'admin' | 'delivery';

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

/**
 * Grants in a stable order (every-model row first, then by model ID and action), so dirty checks compare.
 * Options the rules don't let the editor change (a condition on create, a field list on the every-model
 * row) are kept as they were loaded: the matrix shows them read-only and never drops them.
 */
export const toPermissions = <A extends ContentAction>(
  matrix: PermissionMatrix<A>,
  rules: Pick<MatrixRules<A>, 'actions'>,
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
            condition: grant.ownOnly ? ('ownedByPrincipal' as const) : null,
            fieldIds: grant.fieldIds,
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

/** Whether an action's "own entries" switch can be changed on this row. */
export const canSetOwnOnly = <A extends ContentAction>(action: A, rules: MatrixRules<A>): boolean =>
  rules.ownOnlyActions.has(action);

/** Whether an action's field list can be changed on this row (model rows only: fields belong to a model). */
export const canSetFields = <A extends ContentAction>(
  key: string,
  action: A,
  rules: MatrixRules<A>,
): boolean => key !== ALL_MODELS && rules.fieldScopedActions.has(action);

/** Options a grant carries that this row can't change (loaded from the API), shown read-only. */
export const fixedOptions = <A extends ContentAction>(
  key: string,
  action: A,
  grant: ActionGrant,
  rules: MatrixRules<A>,
): ActionGrant => ({
  ownOnly: grant.ownOnly && !canSetOwnOnly(action, rules),
  fieldIds: canSetFields(key, action, rules) ? null : grant.fieldIds,
});

/** Whether a granted action has options to set or to show on this row. */
export const actionHasOptions = <A extends ContentAction>(
  key: string,
  action: A,
  grant: ActionGrant,
  rules: MatrixRules<A>,
): boolean => {
  const fixed = fixedOptions(key, action, grant, rules);
  return (
    canSetOwnOnly(action, rules) ||
    canSetFields(key, action, rules) ||
    fixed.ownOnly ||
    fixed.fieldIds !== null
  );
};

/** Whether a row has any granted action with options (own entries, fields on a model row, or fixed ones). */
export const hasOptions = <A extends ContentAction>(
  key: string,
  grants: ModelGrants<A> | undefined,
  rules: MatrixRules<A>,
): boolean =>
  rules.actions.some((action) => {
    const grant = grants?.[action];
    return grant !== undefined && actionHasOptions(key, action, grant, rules);
  });

/** Granted rows of the matrix whose model is not among `listedKeys` (deleted models): one entry per grant. */
export const unlistedGrants = <A extends ContentAction>(
  matrix: PermissionMatrix<A>,
  listedKeys: ReadonlySet<string>,
  rules: Pick<MatrixRules<A>, 'actions'>,
): Array<{ modelId: string; action: A; grant: ActionGrant }> =>
  Object.keys(matrix)
    .filter((key) => key !== ALL_MODELS && !listedKeys.has(key))
    .sort()
    .flatMap((modelId) =>
      rules.actions.flatMap((action) => {
        const grant = matrix[modelId]?.[action];
        return grant ? [{ modelId, action, grant }] : [];
      }),
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

/** One checkbox of a field list: a live field, or a ticked one the model no longer shows. */
export type FieldChoice = {
  id: string;
  /** Undefined for an ID that is not a field of the model. */
  label: string | undefined;
  note: 'notPublic' | 'deprecated' | 'unknown' | undefined;
};

/**
 * The checkboxes of a field list (live fields, then ticked deprecated or unknown IDs so they can be
 * cleared) and what "only selected fields" starts from: every live field the audience sees without a list.
 */
export const fieldChoices = (
  fields: readonly FieldDefinition[],
  fieldIds: readonly string[] | null,
  audience: MatrixAudience,
): { choices: FieldChoice[]; defaultSelection: string[] } => {
  const live = fields.filter((field) => !field.deprecated);
  const choices: FieldChoice[] = live.map((field) => ({
    id: field.id,
    label: field.label,
    note: audience === 'delivery' && !field.public ? 'notPublic' : undefined,
  }));
  const liveIds = new Set(live.map((field) => field.id));
  for (const fieldId of fieldIds ?? []) {
    if (!liveIds.has(fieldId)) {
      const field = fields.find((candidate) => candidate.id === fieldId);
      choices.push({ id: fieldId, label: field?.label, note: field ? 'deprecated' : 'unknown' });
    }
  }
  const visible = audience === 'admin' ? live : live.filter((field) => field.public);
  return { choices, defaultSelection: visible.map((field) => field.id) };
};

/** A grant a model gets from an ancestor (plan polymorphic-types D8: a parent's grant flows down to its kinds). */
export type InheritedGrant = { modelId: string; grant: ActionGrant };

export type InheritedGrants<A extends ContentAction> = Partial<Record<A, InheritedGrant[]>>;

/**
 * What a kind inherits per action: each ancestor's grant (root first). Grants union on the server, so a
 * kind's own grant can only add to these; the matrix shows them read-only beside the kind's own.
 */
export const inheritedGrantsOf = <A extends ContentAction>(
  matrix: PermissionMatrix<A>,
  ancestorIds: readonly string[],
  rules: Pick<MatrixRules<A>, 'actions'>,
): InheritedGrants<A> => {
  const inherited: InheritedGrants<A> = {};
  for (const action of rules.actions) {
    const grants = ancestorIds.flatMap((modelId) => {
      const grant = matrix[modelId]?.[action];
      return grant ? [{ modelId, grant }] : [];
    });
    if (grants.length > 0) {
      inherited[action] = grants;
    }
  }
  return inherited;
};
