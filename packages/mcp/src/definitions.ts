import type { ShapioClient } from '@shapio/client';
import { isModelDefinition, routeKeyOf as modelRouteKeyOf, type SchemaDefinition } from '@shapio/schema';

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
 * The delivery route key: a collection's plural API ID (`articles`), a singleton's API ID. The admin content
 * API uses the singular API ID instead. Components have no route.
 */
export const routeKeyOf = (definition: SchemaDefinition): string => {
  if (!isModelDefinition(definition)) {
    throw new Error(
      `"${definition.apiKey}" is a component: components are read through the models that use them`,
    );
  }
  return modelRouteKeyOf(definition);
};

/** A one-line summary per definition, for listings that should not carry every field's settings. */
export const summarize = ({ definition, version, site }: ExportedDefinition) => ({
  id: definition.id,
  /** `shared` (every site), or the key of the site it belongs to. */
  scope: site === null ? 'shared' : site,
  kind: definition.kind,
  apiKey: definition.apiKey,
  ...(definition.kind === 'collection' ? { pluralApiKey: modelRouteKeyOf(definition) } : {}),
  label: definition.label,
  version,
  fields: definition.fields.map((field) => ({
    apiKey: field.apiKey,
    type: field.type,
    required: field.required,
    localized: field.localized,
  })),
});
