import type { ShapioClient } from '@shapio/client';
import {
  createDefinitionIndex,
  isInterfaceDefinition,
  isModelDefinition,
  routeKeyOf as modelRouteKeyOf,
  routePathOf,
  type DefinitionIndex,
  type ModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';

type Exported = Awaited<ReturnType<ShapioClient['admin']['schema']['export']>>;
export type ExportedDefinition = Exported['definitions'][number];

/**
 * The site's active schema (the pull format): its own definitions and the shared ones, for the site the
 * client names (`--site`, else the token's site, else the primary). Read fresh for each call: models change live.
 */
export const readSchema = (client: ShapioClient): Promise<Exported> => client.admin.schema.export();

/** An active definition by API ID (or stable ID); throws a message the agent can act on. */
export const findDefinition = (schema: Exported, key: string): ExportedDefinition => {
  const found = schema.definitions.find(
    ({ definition }) => definition.apiKey === key || definition.id === key,
  );
  if (!found) {
    const known = schema.definitions.map(({ definition }) => definition.apiKey).join(', ') || '(none)';
    throw new Error(`No model, component, or interface with API ID "${key}". Known: ${known}`);
  }
  return found;
};

/**
 * Inheritance lookups over the site's view: a type that extends another stores only its own fields, so
 * anything that describes what a type holds reads the effective fields (the parent's first) through this.
 */
export const indexSchema = (schema: Exported): DefinitionIndex =>
  createDefinitionIndex(schema.definitions.map(({ definition }) => definition));

/** The API ID of a definition in the view, else its ID. */
const apiKeyIn = (index: DefinitionIndex, id: string) => index.get(id)?.apiKey ?? id;

/**
 * The delivery route key: a collection's plural API ID (`articles`), a singleton's API ID, and for a type that
 * extends another its ancestors' plural API IDs and its own (`posts/guides`). An interface's is its plural API
 * ID (`featurables`): its list holds every member's entries. The admin content API uses the singular API ID
 * instead. Components have no route.
 */
export const routeKeyOf = (schema: Exported, definition: SchemaDefinition): string => {
  if (isInterfaceDefinition(definition)) {
    return modelRouteKeyOf(definition);
  }
  if (!isModelDefinition(definition)) {
    throw new Error(
      `"${definition.apiKey}" is a component: components are read through the models that use them`,
    );
  }
  const index = indexSchema(schema);
  const ancestors = index
    .ancestors(definition.id)
    .map((id) => index.get(id))
    .filter((ancestor): ancestor is ModelDefinition => ancestor !== undefined && isModelDefinition(ancestor));
  return routePathOf(definition, ancestors);
};

/** The API IDs of the interfaces a model implements, its ancestors' included; none for other kinds. */
const implementedApiKeys = (index: DefinitionIndex, definition: SchemaDefinition): string[] =>
  isModelDefinition(definition) ? index.interfacesOf(definition.id).map((id) => apiKeyIn(index, id)) : [];

/** The API IDs of an interface's members (kinds of a member included); none for other kinds. */
const memberApiKeys = (index: DefinitionIndex, definition: SchemaDefinition): string[] =>
  isInterfaceDefinition(definition)
    ? index.implementedBy(definition.id).map((id) => apiKeyIn(index, id))
    : [];

/**
 * The fields a model has from the types it extends (none for a root or a component), each naming the type
 * that declares it. The definition itself (the schema file format) holds only its own fields.
 */
export const inheritedFieldsOf = (index: DefinitionIndex, definition: SchemaDefinition) =>
  (index.resolve(definition.id)?.fields ?? []).flatMap((field) =>
    field.inheritedFrom === undefined
      ? []
      : [
          {
            apiKey: field.apiKey,
            type: field.type,
            required: field.required,
            localized: field.localized,
            inheritedFrom: apiKeyIn(index, field.inheritedFrom),
          },
        ],
  );

/**
 * One definition as `schema_get` returns it: the stored definition (send it back to draft a change); for a type
 * that extends another the parent's API ID, its delivery route and the fields it inherits; for a type that
 * implements interfaces their API IDs (inherited ones too); for an interface its route and its members.
 */
export const describeDefinition = (schema: Exported, found: ExportedDefinition) => {
  const { definition } = found;
  const index = indexSchema(schema);
  if (isInterfaceDefinition(definition)) {
    return {
      ...found,
      routeKey: routeKeyOf(schema, definition),
      members: memberApiKeys(index, definition),
    };
  }
  if (!isModelDefinition(definition)) {
    return found;
  }
  const implemented = implementedApiKeys(index, definition);
  return {
    ...found,
    ...(definition.extends === undefined
      ? {}
      : {
          extendsApiKey: apiKeyIn(index, definition.extends),
          routeKey: routeKeyOf(schema, definition),
          inheritedFields: inheritedFieldsOf(index, definition),
        }),
    ...(implemented.length === 0 ? {} : { implementsApiKeys: implemented }),
  };
};

/**
 * A one-line summary per definition, for listings that should not carry every field's settings. Fields are
 * the effective ones: a type that extends another lists its parent's first, each with `inheritedFrom`. An
 * interface's fields are its contract; it lists its members, and a type the interfaces it implements.
 */
export const summarizer = (schema: Exported) => {
  const index = indexSchema(schema);
  return ({ definition, version, site }: ExportedDefinition) => {
    const parent = isModelDefinition(definition) ? definition.extends : undefined;
    const implemented = implementedApiKeys(index, definition);
    return {
      id: definition.id,
      /** `shared` (every site), or the key of the site it belongs to. */
      scope: site === null ? 'shared' : site,
      kind: definition.kind,
      apiKey: definition.apiKey,
      ...(definition.kind === 'collection' || isInterfaceDefinition(definition)
        ? { pluralApiKey: modelRouteKeyOf(definition), routeKey: routeKeyOf(schema, definition) }
        : {}),
      ...(parent === undefined ? {} : { extends: apiKeyIn(index, parent) }),
      ...(implemented.length === 0 ? {} : { implements: implemented }),
      ...(isInterfaceDefinition(definition) ? { members: memberApiKeys(index, definition) } : {}),
      label: definition.label,
      version,
      fields: [
        ...inheritedFieldsOf(index, definition),
        ...definition.fields.map((field) => ({
          apiKey: field.apiKey,
          type: field.type,
          required: field.required,
          localized: field.localized,
        })),
      ],
    };
  };
};
