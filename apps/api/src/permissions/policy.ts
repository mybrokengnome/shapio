import {
  DENIED_POLICY,
  type FieldMask,
  type GlobalAction,
  type KnownVersions,
  type ModelAction,
  type PermissionExecutor,
  type Policy,
  type PolicyRequest,
  type RowCondition,
  type RowFilter,
  type RowFieldMasks,
} from './types.js';

/** One permission row of a role: an action on one model (or every model when `modelId` is null). */
export type Grant = {
  roleId: string;
  action: ModelAction | GlobalAction;
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
    versions?: KnownVersions,
  ) => Promise<readonly ModelField[] | undefined>;
  hasModel: (modelId: string, executor?: PermissionExecutor, versions?: KnownVersions) => Promise<boolean>;
  /**
   * The site a definition belongs to: null when it is shared (or unknown). Schema management of a site's
   * definition is granted by roles held on that site (plan site-schema, rule 4).
   */
  getModelSite: (
    modelId: string,
    executor?: PermissionExecutor,
    versions?: KnownVersions,
  ) => Promise<string | null>;
};

/** Used until the schema registry is wired in: no model is known, so delivery principals see nothing. */
export const NO_FIELD_VISIBILITY: FieldVisibilityLookup = {
  getModelFields: () => Promise.resolve(undefined),
  hasModel: () => Promise.resolve(false),
  getModelSite: () => Promise.resolve(null),
};

const EMPTY_MASK: FieldMask = { mode: 'only', fieldIds: [], componentFields: 'public' };

export const ALLOW_ALL_POLICY: Policy = Object.freeze<Policy>({
  allowed: true,
  rowFilter: null,
  readMask: { mode: 'all' },
  rowReadMasks: null,
  writeMask: { mode: 'all' },
  rowWriteMasks: null,
});

const WRITE_ACTIONS: ReadonlySet<ModelAction> = new Set<ModelAction>(['create', 'update']);

const grantsFor = (grants: readonly Grant[], action: ModelAction, modelId: string) =>
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
 * are always explicit lists, so a field added after evaluation is never exposed by accident. Grants name model
 * fields only, so inside components delivery audiences see the `public` fields alone, whatever they hold.
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
    return { mode: 'only', fieldIds: visible.map((field) => field.id), componentFields: 'public' };
  }
  return { mode: 'only', fieldIds: [...named].sort(), componentFields: 'all' };
};

/** Fields either mask allows. */
export const unionMasks = (left: FieldMask, right: FieldMask): FieldMask =>
  left.mode === 'all' || right.mode === 'all'
    ? { mode: 'all' }
    : {
        mode: 'only',
        fieldIds: [...new Set([...left.fieldIds, ...right.fieldIds])].sort(),
        componentFields: left.componentFields === 'all' || right.componentFields === 'all' ? 'all' : 'public',
      };

/** Fields both masks allow. */
export const intersectMasks = (left: FieldMask, right: FieldMask): FieldMask => {
  if (left.mode === 'all') {
    return right;
  }
  if (right.mode === 'all') {
    return left;
  }
  const kept = new Set(right.fieldIds);
  return {
    mode: 'only',
    fieldIds: left.fieldIds.filter((id) => kept.has(id)),
    componentFields: left.componentFields === 'all' && right.componentFields === 'all' ? 'all' : 'public',
  };
};

/** Whether `outer` allows every field `inner` allows. */
const covers = (outer: FieldMask, inner: FieldMask): boolean =>
  outer.mode === 'all' ||
  (inner.mode === 'only' && inner.fieldIds.every((id) => outer.fieldIds.includes(id)));

/**
 * Field masks per row, for reads (issue #75) and writes (issue #80). Row access and field access are not
 * independent across grants: a field allowed only by a grant with a row condition is allowed only on rows
 * matching that condition. The mask for every row is that of the unconditioned grants; without any, the fields
 * every condition allows (each row the principal acts on matches at least one). null when every row the
 * principal acts on gets the same fields.
 */
export const combineRowFieldMasks = (
  grants: readonly Grant[],
  audience: Audience,
  fields: readonly ModelField[] | undefined,
): RowFieldMasks | null => {
  const kinds = [...new Set(grants.map((grant) => grant.condition))].filter(
    (kind): kind is RowCondition['kind'] => kind !== null,
  );
  if (kinds.length === 0) {
    return null;
  }
  const byCondition = kinds.map((kind) => ({
    condition: { kind },
    mask: combineFieldMasks(
      grants.filter((grant) => grant.condition === kind),
      audience,
      fields,
    ),
  }));
  const unconditioned = grants.filter((grant) => grant.condition === null);
  const everyRow =
    unconditioned.length > 0
      ? combineFieldMasks(unconditioned, audience, fields)
      : byCondition.map((entry) => entry.mask).reduce(intersectMasks);
  const when = byCondition.filter((entry) => !covers(everyRow, entry.mask));
  return when.length === 0 ? null : { everyRow, when };
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
  const writes = WRITE_ACTIONS.has(request.action);
  return {
    allowed: true,
    rowFilter: combineRowFilters(matching),
    readMask: combineFieldMasks(readGrants, audience, fields),
    rowReadMasks: combineRowFieldMasks(readGrants, audience, fields),
    writeMask: writes ? combineFieldMasks(matching, audience, fields) : EMPTY_MASK,
    rowWriteMasks: writes ? combineRowFieldMasks(matching, audience, fields) : null,
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
