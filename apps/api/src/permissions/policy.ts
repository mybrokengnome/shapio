import {
  DENIED_POLICY,
  type ContentAction,
  type FieldMask,
  type GlobalAction,
  type PermissionExecutor,
  type Policy,
  type PolicyRequest,
  type RowCondition,
  type RowFilter,
} from './types.js';

/** One permission row of a role: an action on one model (or every model when `modelId` is null). */
export type Grant = {
  roleId: string;
  action: ContentAction | GlobalAction;
  /** null = every model, including ones created later. Always null for global actions. */
  modelId: string | null;
  condition: RowCondition['kind'] | null;
  /** null = every field the principal's audience may see; otherwise exactly these stable field IDs. */
  fieldIds: readonly string[] | null;
};

/**
 * Who the policy is for. Admin principals (admin users, admin-scope tokens) see every field their grants
 * allow. Delivery principals (delivery tokens, app users, anonymous callers) see only fields with
 * `public: true` unless a grant names a non-public field explicitly (build plan §3.4).
 */
export type Audience = 'admin' | 'delivery';

export type ModelField = { id: string; public: boolean };

/**
 * The one port from permissions to the schema registry (package D implements it from the active schema).
 * `getModelFields`: field definitions for `public` semantics; `undefined` means the model does not exist,
 * which denies delivery access. `hasModel`: whether a model or component ID exists, so role grants can
 * only name real models.
 */
export type FieldVisibilityLookup = {
  getModelFields: (
    modelId: string,
    executor?: PermissionExecutor,
  ) => Promise<readonly ModelField[] | undefined>;
  hasModel: (modelId: string, executor?: PermissionExecutor) => Promise<boolean>;
  /**
   * The site a definition belongs to: null when it is shared (or unknown). Schema management of a site's
   * definition is granted by roles held on that site (plan site-schema, rule 4).
   */
  getModelSite: (modelId: string, executor?: PermissionExecutor) => Promise<string | null>;
};

/** Used until the schema registry is wired in: no model is known, so delivery principals see nothing. */
export const NO_FIELD_VISIBILITY: FieldVisibilityLookup = {
  getModelFields: () => Promise.resolve(undefined),
  hasModel: () => Promise.resolve(false),
  getModelSite: () => Promise.resolve(null),
};

const EMPTY_MASK: FieldMask = { mode: 'only', fieldIds: [] };

export const ALLOW_ALL_POLICY: Policy = Object.freeze<Policy>({
  allowed: true,
  rowFilter: null,
  readMask: { mode: 'all' },
  writeMask: { mode: 'all' },
});

const WRITE_ACTIONS: ReadonlySet<ContentAction> = new Set(['create', 'update']);

const grantsFor = (grants: readonly Grant[], action: ContentAction, modelId: string) =>
  grants.filter((grant) => grant.action === action && (grant.modelId === null || grant.modelId === modelId));

/** Rows: the union of what each grant allows. Any unconditional grant means no restriction. */
export const combineRowFilters = (grants: readonly Grant[]): RowFilter | null => {
  if (grants.some((grant) => grant.condition === null)) {
    return null;
  }
  const kinds = [...new Set(grants.map((grant) => grant.condition))].filter(
    (kind): kind is RowCondition['kind'] => kind !== null,
  );
  const filters: RowFilter[] = kinds.map((kind) => ({ kind }));
  if (filters.length === 1 && filters[0]) {
    return filters[0];
  }
  return { kind: 'or', filters };
};

/**
 * Fields: the union of what each grant allows. For delivery audiences a wildcard grant expands to the
 * model's public fields, so `public: false` fields stay hidden unless a grant names them. Delivery masks
 * are always explicit lists, so a field added after evaluation is never exposed by accident.
 */
export const combineFieldMasks = (
  grants: readonly Grant[],
  audience: Audience,
  fields: readonly ModelField[] | undefined,
): FieldMask => {
  if (grants.length === 0) {
    return EMPTY_MASK;
  }
  const hasWildcard = grants.some((grant) => grant.fieldIds === null);
  if (audience === 'admin' && hasWildcard) {
    return { mode: 'all' };
  }
  const named = new Set(grants.flatMap((grant) => grant.fieldIds ?? []));
  if (audience === 'delivery') {
    const known = fields ?? [];
    const visible = known.filter((field) => named.has(field.id) || (hasWildcard && field.public));
    return { mode: 'only', fieldIds: visible.map((field) => field.id) };
  }
  return { mode: 'only', fieldIds: [...named].sort() };
};

/**
 * The policy for one (action, model) request from a principal's grants. Pure: no I/O, so it is unit- and
 * property-tested directly. Deny by default: no matching grant, no access.
 */
export const buildPolicy = (
  grants: readonly Grant[],
  request: PolicyRequest,
  audience: Audience,
  fields: readonly ModelField[] | undefined,
): Policy => {
  if (audience === 'delivery' && fields === undefined) {
    // Unknown model: without its field definitions no delivery mask can be computed safely.
    return DENIED_POLICY;
  }
  const matching = grantsFor(grants, request.action, request.modelId);
  if (matching.length === 0) {
    return DENIED_POLICY;
  }
  const readGrants = request.action === 'read' ? matching : grantsFor(grants, 'read', request.modelId);
  return {
    allowed: true,
    rowFilter: combineRowFilters(matching),
    readMask: combineFieldMasks(readGrants, audience, fields),
    writeMask: WRITE_ACTIONS.has(request.action) ? combineFieldMasks(matching, audience, fields) : EMPTY_MASK,
  };
};

/** Global actions are granted only by a grant on that action with no model. */
export const allowsGlobalAction = (grants: readonly Grant[], action: GlobalAction): boolean =>
  grants.some((grant) => grant.action === action && grant.modelId === null);

/**
 * A fixed lookup (model ID → fields), for tests and tools that have no schema registry. `hasModel` accepts
 * every ID unless `knownModelsOnly` is set, so tests can grant on models they never define.
 */
export const createStaticFieldVisibility = (
  models: Readonly<Record<string, readonly ModelField[]>>,
  {
    knownModelsOnly = false,
    modelSites = {},
  }: { knownModelsOnly?: boolean; modelSites?: Readonly<Record<string, string>> } = {},
): FieldVisibilityLookup => ({
  getModelFields: (modelId) => Promise.resolve(Object.hasOwn(models, modelId) ? models[modelId] : undefined),
  hasModel: (modelId) => Promise.resolve(!knownModelsOnly || Object.hasOwn(models, modelId)),
  getModelSite: (modelId) =>
    Promise.resolve(Object.hasOwn(modelSites, modelId) ? (modelSites[modelId] ?? null) : null),
});
