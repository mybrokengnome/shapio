import {
  embeddedComponentIds,
  isComponentDefinition,
  type ComponentDefinition,
  type FieldDefinition,
  type ModelDefinition,
} from '@shapio/schema';
import { AppError } from '../helpers/appError.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';

/** Head states (ADR 0001): every entry has a draft per locale and, once published, a published head. */
export const HEAD_STATES = ['draft', 'published'] as const;
export type HeadState = (typeof HEAD_STATES)[number];

/** Unique-registry locale for shared (non-localized) fields: one value across every locale. */
export const SHARED_LOCALE = '*';

/** A collection or singleton resolved from a pinned snapshot, with what writes need to know about it. */
export type ContentModel = {
  definition: ModelDefinition;
  /** Per-model version at the pinned snapshot (re-checked at commit). */
  version: number;
  revisionId: string;
  /** Components reachable from the model (directly or through other components), with their versions. */
  components: ReadonlyMap<string, { definition: ComponentDefinition; version: number }>;
};

export const modelNotFound = (key: string) =>
  new AppError(404, 'MODEL_NOT_FOUND', `No content model "${key}"`, { modelKey: key });

const collectComponents = (snapshot: SchemaSnapshot, model: ModelDefinition): ContentModel['components'] => {
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

/** Resolves `/api/…/content/:modelKey` through the registry at request time (CONTRIBUTING.md rule 2). */
export const resolveModel = (snapshot: SchemaSnapshot, modelKey: string): ContentModel => {
  const active = snapshot.modelsByApiKey.get(modelKey);
  if (!active || isComponentDefinition(active.definition)) {
    throw modelNotFound(modelKey);
  }
  return {
    definition: active.definition,
    version: active.version,
    revisionId: active.revisionId,
    components: collectComponents(snapshot, active.definition),
  };
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

export const resolveModelById = (snapshot: SchemaSnapshot, modelId: string): ContentModel | undefined => {
  const active = snapshot.byId.get(modelId);
  return active && !isComponentDefinition(active.definition)
    ? resolveModel(snapshot, active.definition.apiKey)
    : undefined;
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
