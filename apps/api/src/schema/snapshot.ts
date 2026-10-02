import {
  findDependentModels,
  isComponentDefinition,
  routeKeyOf,
  type LocaleDefinition,
  type SchemaDefinition,
} from '@shapio/schema';

/** One definition as it is active right now. */
export type ActiveDefinition = {
  definition: SchemaDefinition;
  /** Per-model version: the optimistic-concurrency token for edits. */
  version: number;
  revisionId: string;
  hash: string;
  activatedAt: Date;
};

/**
 * Two models whose route keys are equal. The validator refuses this on save, but a collection stored before
 * plural API IDs gets a derived plural on read, which can equal another model's API ID (`post` → `posts`).
 */
export type RouteKeyCollision = { routeKey: string; servedApiKey: string; hiddenApiKey: string };

/**
 * An immutable view of the whole active schema at one global version. Requests pin one snapshot for their
 * whole lifetime, so a model never changes shape halfway through a request.
 */
export type SchemaSnapshot = {
  version: number;
  definitions: readonly ActiveDefinition[];
  byId: ReadonlyMap<string, ActiveDefinition>;
  /** Collections and singletons by exact API key (the admin content API and GraphQL resolve here). */
  modelsByApiKey: ReadonlyMap<string, ActiveDefinition>;
  /**
   * Collections by plural API ID and singletons by API ID (`routeKeyOf`): the delivery and preview routes
   * resolve `/api/content/:modelKey` here.
   */
  modelsByRouteKey: ReadonlyMap<string, ActiveDefinition>;
  /** Route keys claimed twice; the registry logs them. Empty for any schema the validator accepted. */
  routeKeyCollisions: readonly RouteKeyCollision[];
  componentsByApiKey: ReadonlyMap<string, ActiveDefinition>;
  locales: readonly LocaleDefinition[];
  defaultLocale: string;
  /** Models whose entries embed this component, directly or through other components. */
  dependentModelIds: (componentId: string) => string[];
};

/**
 * On a collision the model whose API ID is the route key keeps it (a singleton keeps the URL it always
 * had); otherwise the first definition does. Deterministic, so every instance serves the same model.
 */
const indexByRouteKey = (definitions: readonly ActiveDefinition[]) => {
  const modelsByRouteKey = new Map<string, ActiveDefinition>();
  const routeKeyCollisions: RouteKeyCollision[] = [];
  for (const active of definitions) {
    if (isComponentDefinition(active.definition)) {
      continue;
    }
    const routeKey = routeKeyOf(active.definition);
    const existing = modelsByRouteKey.get(routeKey);
    if (!existing) {
      modelsByRouteKey.set(routeKey, active);
      continue;
    }
    const takesOver = active.definition.apiKey === routeKey;
    const [served, hidden] = takesOver ? [active, existing] : [existing, active];
    modelsByRouteKey.set(routeKey, served);
    routeKeyCollisions.push({
      routeKey,
      servedApiKey: served.definition.apiKey,
      hiddenApiKey: hidden.definition.apiKey,
    });
  }
  return { modelsByRouteKey, routeKeyCollisions };
};

export const buildSnapshot = (
  version: number,
  definitions: readonly ActiveDefinition[],
  locales: readonly LocaleDefinition[],
): SchemaSnapshot => {
  const byId = new Map(definitions.map((active) => [active.definition.id, active]));
  const modelsByApiKey = new Map<string, ActiveDefinition>();
  const componentsByApiKey = new Map<string, ActiveDefinition>();
  for (const active of definitions) {
    (isComponentDefinition(active.definition) ? componentsByApiKey : modelsByApiKey).set(
      active.definition.apiKey,
      active,
    );
  }
  const { modelsByRouteKey, routeKeyCollisions } = indexByRouteKey(definitions);
  const all = definitions.map((active) => active.definition);
  const dependents = new Map<string, string[]>();
  return Object.freeze({
    version,
    definitions,
    byId,
    modelsByApiKey,
    modelsByRouteKey,
    routeKeyCollisions,
    componentsByApiKey,
    locales,
    defaultLocale: locales.find((locale) => locale.isDefault)?.code ?? 'en',
    dependentModelIds: (componentId: string) => {
      let ids = dependents.get(componentId);
      if (!ids) {
        ids = findDependentModels(all, componentId).map((definition) => definition.id);
        dependents.set(componentId, ids);
      }
      return ids;
    },
  });
};
