import { createHash } from 'node:crypto';
import {
  isComponentDefinition,
  isModelDefinition,
  type FieldDefinition,
  type ModelDefinition,
  type ResolvedModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { liveFields } from '../../../content/model.js';
import type {
  FieldMask,
  ModelAction,
  PermissionEvaluator,
  Policy,
  Principal,
} from '../../../permissions/types.js';
import type { SchemaSnapshot } from '../../snapshot.js';

/**
 * Which parts of a site's schema one caller may see (issue #55: a delivery caller's schema never names a field
 * or model it cannot read). Admin callers get `FULL_VISIBILITY`: every model and field, values still masked
 * when resolved. Delivery callers (delivery tokens, app users, anonymous callers) get the models some policy
 * allows and, per model, the fields of its read mask (outputs, filters, sorts) and of its create and update
 * write masks (inputs); inside components, `public` fields only, as the delivery projection.
 *
 * Masks are the per-model unions `Policy.readMask` and `Policy.writeMask`: a field one grant shows on some rows
 * only is in the schema and resolves to null on the other rows (the resolve-time check in outputTypes.ts).
 * A model that extends another is evaluated over its effective fields (inherited first), with its ancestors'
 * grants applying to it (plan polymorphic-types D8).
 */
export type ModelVisibility = {
  /** Read queries and the entry type exist only when the caller may read the model. */
  readable: boolean;
  readFields: ReadonlySet<string>;
  writeFields: ReadonlySet<string>;
};

export type SchemaVisibility = {
  /** Same key, same schema: callers with the same masks share one build (schemaCache.ts). */
  key: string;
  /** null: every model with every field (admin callers). */
  models: ReadonlyMap<string, ModelVisibility> | null;
  /** Inside components: every live field, or only `public` ones (delivery callers). */
  componentFields: 'all' | 'public';
};

export const FULL_VISIBILITY: SchemaVisibility = Object.freeze({
  key: 'full',
  models: null,
  componentFields: 'all',
});

/** The per-model actions a GraphQL schema exposes: read queries and the five mutations' actions. */
const SCHEMA_ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
  'publish',
] as const satisfies readonly ModelAction[];
type SchemaAction = (typeof SCHEMA_ACTIONS)[number];

/** Delivery callers see `public: false` fields only where a grant names them (ADR 0005); admins see all. */
const isDeliveryPrincipal = (principal: Principal): boolean =>
  principal.kind === 'appUser' ||
  principal.kind === 'anonymous' ||
  (principal.kind === 'token' && principal.scope === 'delivery');

const maskFieldIds = (model: ModelDefinition, mask: FieldMask): string[] =>
  mask.mode === 'all' ? liveFields(model.fields).map((field) => field.id) : [...mask.fieldIds];

const modelVisibility = (
  model: ModelDefinition,
  policies: Readonly<Record<SchemaAction, Policy>>,
): ModelVisibility => {
  const writeFields = new Set<string>();
  for (const action of ['create', 'update'] as const) {
    if (policies[action].allowed) {
      maskFieldIds(model, policies[action].writeMask).forEach((id) => writeFields.add(id));
    }
  }
  return {
    readable: policies.read.allowed,
    readFields: new Set(policies.read.allowed ? maskFieldIds(model, policies.read.readMask) : []),
    writeFields,
  };
};

const sorted = (ids: ReadonlySet<string>) => [...ids].sort().join(',');

/** A stable digest of the visible models and fields, so equal visibility gives an equal key. */
const visibilityKey = (models: ReadonlyMap<string, ModelVisibility>): string => {
  const canonical = [...models]
    .map(
      ([id, model]) =>
        `${id}|${model.readable ? 'r' : '-'}|${sorted(model.readFields)}|${sorted(model.writeFields)}`,
    )
    .join('\n');
  return `delivery:${createHash('sha256').update(canonical).digest('base64url')}`;
};

/**
 * The caller's visibility over a site view, from the request's (memoized) evaluator. A model is in the schema
 * when any of the schema's actions is allowed on it; a model no policy allows is absent, name included.
 */
export const resolveSchemaVisibility = async (
  view: SchemaSnapshot,
  permissions: PermissionEvaluator,
  principal: Principal,
): Promise<SchemaVisibility> => {
  if (!isDeliveryPrincipal(principal)) {
    return FULL_VISIBILITY;
  }
  const models = view.definitions
    .map((active) => active.definition)
    .filter((definition): definition is ModelDefinition => isModelDefinition(definition))
    .map((definition) => view.resolve(definition.id))
    .filter((model): model is ResolvedModelDefinition => model !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id));
  const evaluated = await Promise.all(
    models.map(async (model) => {
      const policies = await Promise.all(
        SCHEMA_ACTIONS.map((action) => permissions.evaluate(principal, { action, modelId: model.id })),
      );
      return {
        model,
        policies: Object.fromEntries(SCHEMA_ACTIONS.map((action, i) => [action, policies[i]])) as Record<
          SchemaAction,
          Policy
        >,
      };
    }),
  );
  const visible = new Map<string, ModelVisibility>();
  for (const { model, policies } of evaluated) {
    if (SCHEMA_ACTIONS.some((action) => policies[action].allowed)) {
      visible.set(model.id, modelVisibility(model, policies));
    }
  }
  return { key: visibilityKey(visible), models: visible, componentFields: 'public' };
};

/** Whether the caller may neither read nor write any model of the view (its schema names no model). */
export const hasNoContentAccess = (visibility: SchemaVisibility): boolean =>
  visibility.models !== null && visibility.models.size === 0;

/** Whether a model is in the schema at all (read queries or mutations). */
export const modelInSchema = (visibility: SchemaVisibility, modelId: string): boolean =>
  visibility.models === null || visibility.models.has(modelId);

/** Whether a model's read queries and entry type are in the schema (relation fields to it too). */
export const modelReadable = (visibility: SchemaVisibility, modelId: string): boolean =>
  visibility.models === null || visibility.models.get(modelId)?.readable === true;

const visibleFields = (
  visibility: SchemaVisibility,
  owner: SchemaDefinition,
  pick: (model: ModelVisibility) => ReadonlySet<string>,
): FieldDefinition[] => {
  const live = liveFields(owner.fields);
  if (isComponentDefinition(owner)) {
    return visibility.componentFields === 'all' ? live : live.filter((field) => field.public);
  }
  if (visibility.models === null) {
    return live;
  }
  const model = visibility.models.get(owner.id);
  const allowed = model ? pick(model) : new Set<string>();
  return live.filter((field) => allowed.has(field.id));
};

/** Fields of a model (its read mask) or component that outputs, filters and sorts may name. */
export const readableFields = (visibility: SchemaVisibility, owner: SchemaDefinition): FieldDefinition[] =>
  visibleFields(visibility, owner, (model) => model.readFields);

/** Fields of a model (its create and update write masks) or component that inputs may name. */
export const writableFields = (visibility: SchemaVisibility, owner: SchemaDefinition): FieldDefinition[] =>
  visibleFields(visibility, owner, (model) => model.writeFields);
