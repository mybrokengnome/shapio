import {
  embeddedComponentIds,
  isComponentDefinition,
  isModelDefinition,
  routePathOf,
  type ComponentDefinition,
  type FieldDefinition,
  type ModelDefinition,
  type ResolvedModelDefinition,
} from '@shapio/schema';
import { AppError } from '../helpers/appError.js';
import type { ActiveDefinition, SchemaById, SchemaSnapshot } from '../schema/snapshot.js';

/** Head states (ADR 0001): every entry has a draft per locale and, once published, a published head. */
export const HEAD_STATES = ['draft', 'published'] as const;
export type HeadState = (typeof HEAD_STATES)[number];

/** Unique-registry locale for shared (non-localized) fields: one value across every locale. */
export const SHARED_LOCALE = '*';

/** A collection or singleton resolved from a pinned snapshot, with what writes need to know about it. */
export type ContentModel = {
  /** The effective definition: inherited fields first (`inheritedFrom` set), then the model's own. */
  definition: ResolvedModelDefinition;
  /** Per-model version at the pinned snapshot (re-checked at commit). */
  version: number;
  revisionId: string;
  /**
   * The models this one extends, by ID, at the pinned snapshot: a parent change changes this model's shape
   * without changing its own version, so writes re-check these too and validators are cached by them.
   */
  ancestors: ReadonlyMap<string, { version: number; revisionId: string }>;
  /** Components reachable from the model's effective fields (directly or through other components). */
  components: ReadonlyMap<string, { definition: ComponentDefinition; version: number }>;
  /**
   * Where the model is served (plan polymorphic-types): its route key (`products/digital`) and its ancestors'
   * API IDs, root first. Set by the resolvers here; absent on models built by hand.
   */
  route?: ModelRoute;
};

export type ModelRoute = { key: string; ancestors: readonly string[] };

/** Where a model is served: its nested route key and its ancestors' API IDs, root first. */
export const modelRouteOf = (snapshot: SchemaById, definition: ModelDefinition): ModelRoute => {
  const ancestorIds = snapshot.ancestors(definition.id);
  const ancestors = ancestorIds
    .map((id) => snapshot.byId.get(id)?.definition)
    .filter((ancestor): ancestor is ModelDefinition => ancestor !== undefined && isModelDefinition(ancestor));
  return { key: routePathOf(definition, ancestors), ancestors: ancestors.map((ancestor) => ancestor.apiKey) };
};

export const modelNotFound = (key: string) =>
  new AppError(404, 'MODEL_NOT_FOUND', `No content model "${key}"`, { modelKey: key });

const collectComponents = (snapshot: SchemaById, model: ModelDefinition): ContentModel['components'] => {
  const found = new Map<string, { definition: ComponentDefinition; version: number }>();
  const queue = embeddedComponentIds(model);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const active = snapshot.byId.get(id);
    if (!active || found.has(id) || !isComponentDefinition(active.definition)) {
      continue;
    }
    found.set(id, { definition: active.definition, version: active.version });
    queue.push(...embeddedComponentIds(active.definition));
  }
  return found;
};

const ancestorsOf = (snapshot: SchemaById, definition: ResolvedModelDefinition): ContentModel['ancestors'] =>
  new Map(
    definition.ancestorIds.flatMap((id) => {
      const ancestor = snapshot.byId.get(id);
      return ancestor ? [[id, { version: ancestor.version, revisionId: ancestor.revisionId }] as const] : [];
    }),
  );

const toContentModel = (
  snapshot: SchemaById,
  active: ActiveDefinition & { definition: ModelDefinition },
): ContentModel => {
  const definition = snapshot.resolve(active.definition.id) as ResolvedModelDefinition;
  return {
    definition,
    version: active.version,
    revisionId: active.revisionId,
    ancestors: ancestorsOf(snapshot, definition),
    components: collectComponents(snapshot, definition),
    route: modelRouteOf(snapshot, definition),
  };
};

const isModel = (
  active: ActiveDefinition | undefined,
): active is ActiveDefinition & { definition: ModelDefinition } =>
  active !== undefined && !isComponentDefinition(active.definition);

/**
 * Resolves `/api/…/content/:modelKey` through the registry at request time (CONTRIBUTING.md rule 2). Only a
 * site's view resolves API IDs: another site's model is not in it, so it reads as not found.
 */
export const resolveModel = (snapshot: SchemaSnapshot, modelKey: string): ContentModel => {
  const active = snapshot.modelsByApiKey.get(modelKey);
  if (!isModel(active)) {
    throw modelNotFound(modelKey);
  }
  return toContentModel(snapshot, active);
};

/**
 * Resolves the delivery and preview routes' `:modelKey`, the route key (`routeKeyOf`): the plural API ID
 * of a collection, the API ID of a singleton. A collection's singular API ID is not a route key (404).
 */
export const resolveRouteModel = (snapshot: SchemaSnapshot, routeKey: string): ContentModel => {
  const active = snapshot.modelsByRouteKey.get(routeKey);
  if (!active || isComponentDefinition(active.definition)) {
    throw modelNotFound(routeKey);
  }
  return resolveModel(snapshot, active.definition.apiKey);
};

/** The API ID behind a route key: REST entry points translate with it, then call the services. */
export const apiKeyOfRoute = (snapshot: SchemaSnapshot, routeKey: string): string =>
  resolveRouteModel(snapshot, routeKey).definition.apiKey;

/** By stable ID: works on a view and on the full set (jobs and conversions that already know the site). */
export const resolveModelById = (snapshot: SchemaById, modelId: string): ContentModel | undefined => {
  const active = snapshot.byId.get(modelId);
  return isModel(active) ? toContentModel(snapshot, active) : undefined;
};

/** Whether a field's value differs per locale. Fields of a non-localized model are always shared. */
export const isLocalizedField = (model: ModelDefinition, field: FieldDefinition): boolean =>
  model.localized && field.localized;

/** Fields the API exposes (deprecated fields keep their stored values but are hidden). */
export const liveFields = (fields: readonly FieldDefinition[]): FieldDefinition[] =>
  fields.filter((field) => !field.deprecated);

export const findFieldByApiKey = (
  fields: readonly FieldDefinition[],
  apiKey: string,
): FieldDefinition | undefined => fields.find((field) => field.apiKey === apiKey && !field.deprecated);
