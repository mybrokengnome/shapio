import type { ShapioClient } from '@shapio/client';
import {
  createDefinitionIndex,
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
    throw new Error(`No model or component with API ID "${key}". Known: ${known}`);
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
 * extends another its ancestors' plural API IDs and its own (`products/digital`). The admin content API uses
 * the singular API ID instead. Components have no route.
 */
export const routeKeyOf = (schema: Exported, definition: SchemaDefinition): string => {
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
 * One definition as `schema_get` returns it: the stored definition (send it back to draft a change), and for a
 * type that extends another the parent's API ID, its delivery route and the fields it inherits.
 */
export const describeDefinition = (schema: Exported, found: ExportedDefinition) => {
  const { definition } = found;
  if (!isModelDefinition(definition) || definition.extends === undefined) {
    return found;
  }
  const index = indexSchema(schema);
  return {
    ...found,
    extendsApiKey: apiKeyIn(index, definition.extends),
    routeKey: routeKeyOf(schema, definition),
    inheritedFields: inheritedFieldsOf(index, definition),
  };
};

/**
 * A one-line summary per definition, for listings that should not carry every field's settings. Fields are
 * the effective ones: a type that extends another lists its parent's first, each with `inheritedFrom`.
 */
export const summarizer = (schema: Exported) => {
  const index = indexSchema(schema);
  return ({ definition, version, site }: ExportedDefinition) => {
    const parent = isModelDefinition(definition) ? definition.extends : undefined;
    return {
      id: definition.id,
      /** `shared` (every site), or the key of the site it belongs to. */
      scope: site === null ? 'shared' : site,
      kind: definition.kind,
      apiKey: definition.apiKey,
      ...(definition.kind === 'collection'
        ? { pluralApiKey: modelRouteKeyOf(definition), routeKey: routeKeyOf(schema, definition) }
        : {}),
      ...(parent === undefined ? {} : { extends: apiKeyIn(index, parent) }),
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
