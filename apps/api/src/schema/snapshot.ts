import {
  createDefinitionIndex,
  findDependentModels,
  isComponentDefinition,
  isInterfaceDefinition,
  isModelDefinition,
  routeKeyOf,
  routePathOf,
  type DefinitionIndex,
  type LocaleDefinition,
  type ModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';

/** One definition as it is active right now. */
export type ActiveDefinition = {
  definition: SchemaDefinition;
  /** The site the definition belongs to; null when it is shared by every site (plan site-schema). */
  siteId: string | null;
  /** Per-model version: the optimistic-concurrency token for edits. */
  version: number;
  revisionId: string;
  hash: string;
  activatedAt: Date;
};

/**
 * Two definitions (models or interfaces) whose route keys are equal. The validator refuses this on save, but a collection stored before
 * plural API IDs gets a derived plural on read, which can equal another model's API ID (`post` → `posts`).
 */
export type RouteKeyCollision = { routeKey: string; servedApiKey: string; hiddenApiKey: string };

/**
 * Model inheritance over the schema (plan polymorphic-types), from `@shapio/schema`'s `createDefinitionIndex`:
 * `resolve` gives a model's effective definition (inherited fields first, `inheritedFrom` set), the others
 * walk the family. `byId` and `definitions` keep the stored definitions (own fields only), which the planner,
 * activation, sync and hashing need; everything that reads content uses `resolve` (or `ContentModel`).
 * Interfaces (plan interfaces): `interfacesOf`, `implementedBy`, `memberFieldOf` and `contractFieldsOf`
 * answer within the same set, so a site's view sees the members on that site and the shared ones.
 */
export type SchemaInheritance = Pick<
  DefinitionIndex,
  | 'resolve'
  | 'ancestors'
  | 'childrenOf'
  | 'descendants'
  | 'family'
  | 'rootOf'
  | 'interfacesOf'
  | 'implementedBy'
  | 'memberFieldOf'
  | 'contractFieldsOf'
>;

/**
 * What every schema exposes: lookups by stable ID, the locales, and scopes. Code that only resolves by ID
 * (content checks, validators, conversions) takes this, so it works on the full set and on a site's view.
 */
export type SchemaById = SchemaInheritance & {
  version: number;
  definitions: readonly ActiveDefinition[];
  /** Stored definitions (own fields only); `resolve` gives a model's effective fields. */
  byId: ReadonlyMap<string, ActiveDefinition>;
  /** The site a definition belongs to: null when shared, undefined when no such definition is active. */
  scopeOf: (id: string) => string | null | undefined;
  locales: readonly LocaleDefinition[];
  defaultLocale: string;
  /** Models whose entries embed this component: directly, through other components or by inheritance. */
  dependentModelIds: (componentId: string) => string[];
};

/**
 * The whole active schema at one global version: every site's definitions and the shared ones. It has no
 * lookups by API ID on purpose: two sites may each have a `post`, so a key only means something in a view.
 * The registry loads and caches this; requests read a view of it (`forSite`).
 */
export type NetworkSchema = SchemaById & {
  /** A site's view: the shared definitions and that site's (memoised per site). */
  forSite: (siteId: string) => SchemaSnapshot;
  /** The shared definitions alone (network routes, the Network pages). */
  shared: () => SchemaSnapshot;
};

/**
 * One site's view of the schema at one global version (or the shared definitions alone, `siteId` null).
 * Requests pin one for their whole lifetime, so a model never changes shape halfway through a request.
 */
export type SchemaSnapshot = SchemaById & {
  /** The site this view is for; null for the shared definitions alone. */
  siteId: string | null;
  /** Collections and singletons by exact API key (the admin content API and GraphQL resolve here). */
  modelsByApiKey: ReadonlyMap<string, ActiveDefinition>;
  /** Interfaces by exact API key (plan interfaces); never in `modelsByApiKey`. */
  interfacesByApiKey: ReadonlyMap<string, ActiveDefinition>;
  /**
   * Collections by route key (`routePathOf`: the plural API ID, under the ancestors' for a model that extends
   * another, `products/digital`) and singletons by API ID: the delivery and preview routes resolve
   * `/api/content/:modelKey` here. A child is reachable only by its nested key.
   */
  modelsByRouteKey: ReadonlyMap<string, ActiveDefinition>;
  /** Interfaces by route key (their plural API ID; interfaces never nest): `/api/content/featurables`. */
  interfacesByRouteKey: ReadonlyMap<string, ActiveDefinition>;
  /** Route keys claimed twice; the registry logs them. Empty for any schema the validator accepted. */
  routeKeyCollisions: readonly RouteKeyCollision[];
  componentsByApiKey: ReadonlyMap<string, ActiveDefinition>;
  /** The full set at the same version (planning, validation across sites). */
  network: NetworkSchema;
};

/**
 * On a collision the model whose API ID is the route key keeps it (a singleton keeps the URL it always
 * had); otherwise the first definition does. Deterministic, so every instance serves the same model. An
 * interface never takes a route key a model holds: its plural is checked against models' on save, so a
 * collision only comes from a stored collection's derived plural, whose URL keeps working.
 */
const indexByRouteKey = (definitions: readonly ActiveDefinition[], inheritance: SchemaInheritance) => {
  const modelsByRouteKey = new Map<string, ActiveDefinition>();
  const routeKeyCollisions: RouteKeyCollision[] = [];
  const byId = new Map(definitions.map((active) => [active.definition.id, active.definition]));
  for (const active of definitions) {
    if (!isModelDefinition(active.definition)) {
      continue;
    }
    const ancestors = inheritance
      .ancestors(active.definition.id)
      .map((id) => byId.get(id))
      .filter(
        (ancestor): ancestor is ModelDefinition => ancestor !== undefined && isModelDefinition(ancestor),
      );
    const routeKey = routePathOf(active.definition, ancestors);
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
  const interfacesByRouteKey = new Map<string, ActiveDefinition>();
  for (const active of definitions) {
    if (!isInterfaceDefinition(active.definition)) {
      continue;
    }
    const routeKey = routeKeyOf(active.definition);
    const holder = modelsByRouteKey.get(routeKey) ?? interfacesByRouteKey.get(routeKey);
    if (holder) {
      routeKeyCollisions.push({
        routeKey,
        servedApiKey: holder.definition.apiKey,
        hiddenApiKey: active.definition.apiKey,
      });
      continue;
    }
    interfacesByRouteKey.set(routeKey, active);
  }
  return { modelsByRouteKey, interfacesByRouteKey, routeKeyCollisions };
};

const byIdPart = (
  version: number,
  definitions: readonly ActiveDefinition[],
  locales: readonly LocaleDefinition[],
): SchemaById => {
  const byId = new Map(definitions.map((active) => [active.definition.id, active]));
  const all = definitions.map((active) => active.definition);
  const dependents = new Map<string, string[]>();
  const index = createDefinitionIndex(all);
  return {
    resolve: index.resolve,
    ancestors: index.ancestors,
    childrenOf: index.childrenOf,
    descendants: index.descendants,
    family: index.family,
    rootOf: index.rootOf,
    interfacesOf: index.interfacesOf,
    implementedBy: index.implementedBy,
    memberFieldOf: index.memberFieldOf,
    contractFieldsOf: index.contractFieldsOf,
    version,
    definitions,
    byId,
    scopeOf: (id) => byId.get(id)?.siteId,
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
  };
};

const buildView = (
  network: NetworkSchema,
  siteId: string | null,
  definitions: readonly ActiveDefinition[],
): SchemaSnapshot => {
  const modelsByApiKey = new Map<string, ActiveDefinition>();
  const componentsByApiKey = new Map<string, ActiveDefinition>();
  const interfacesByApiKey = new Map<string, ActiveDefinition>();
  for (const active of definitions) {
    const byKey = isComponentDefinition(active.definition)
      ? componentsByApiKey
      : isInterfaceDefinition(active.definition)
        ? interfacesByApiKey
        : modelsByApiKey;
    byKey.set(active.definition.apiKey, active);
  }
  const part = byIdPart(network.version, definitions, network.locales);
  const { modelsByRouteKey, interfacesByRouteKey, routeKeyCollisions } = indexByRouteKey(definitions, part);
  return Object.freeze({
    ...part,
    siteId,
    modelsByApiKey,
    interfacesByApiKey,
    modelsByRouteKey,
    interfacesByRouteKey,
    routeKeyCollisions,
    componentsByApiKey,
    network,
  });
};

/** The full schema at one version; views are built on first use and kept for the snapshot's lifetime. */
export const buildNetworkSchema = (
  version: number,
  definitions: readonly ActiveDefinition[],
  locales: readonly LocaleDefinition[],
): NetworkSchema => {
  const views = new Map<string | null, SchemaSnapshot>();
  const viewOf = (siteId: string | null): SchemaSnapshot => {
    let view = views.get(siteId);
    if (!view) {
      view = buildView(
        network,
        siteId,
        definitions.filter((active) => active.siteId === null || active.siteId === siteId),
      );
      views.set(siteId, view);
    }
    return view;
  };
  const network: NetworkSchema = Object.freeze({
    ...byIdPart(version, definitions, locales),
    forSite: (siteId: string) => viewOf(siteId),
    shared: () => viewOf(null),
  });
  return network;
};

/**
 * A view built straight from definitions (tests, generated references, proposed schemas): the view of
 * `siteId` (the shared definitions alone when null) over a full set made of `definitions`.
 */
export const buildSnapshot = (
  version: number,
  definitions: readonly ActiveDefinition[],
  locales: readonly LocaleDefinition[],
  siteId: string | null = null,
): SchemaSnapshot => {
  const network = buildNetworkSchema(version, definitions, locales);
  return siteId === null ? network.shared() : network.forSite(siteId);
};

/** The sites whose views hold a definition of `definitions` (null: the shared definitions). */
export const siteIdsOf = (definitions: readonly ActiveDefinition[]): string[] => [
  ...new Set(definitions.flatMap((active) => (active.siteId === null ? [] : [active.siteId]))),
];
