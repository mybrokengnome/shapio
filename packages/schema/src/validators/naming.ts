import { suggestPlural } from '../naming/plural.js';
import type { ModelDefinition, SchemaDefinition } from '../types/definitions.js';

/**
 * The names GraphQL (package J) and other generated contracts derive from API keys. Defined here, with the
 * validator, so a name that would collide in GraphQL is rejected when the model is saved, never later.
 * Package J must generate exactly these names.
 */
export const toTypeName = (apiKey: string): string => apiKey.charAt(0).toUpperCase() + apiKey.slice(1);

/** Suffixes of the types generated for each model (`Page`, `PageFilter`, `PageInput`...). */
export const MODEL_TYPE_SUFFIXES = [
  '',
  'Filter',
  'Input',
  'Connection',
  'Edge',
  'Localizations',
  'Sort',
] as const;
export const COMPONENT_TYPE_SUFFIXES = ['', 'Input'] as const;
export const MUTATION_PREFIXES = ['create', 'update', 'delete', 'publish', 'unpublish'] as const;

/**
 * The key a model is addressed by in the delivery API (`/api/content/:routeKey`, preview routes): the
 * plural API ID of a collection, the API ID of a singleton. A collection stored before plural API IDs
 * existed gets the same derived value normalizing would fill, so this never returns undefined.
 */
export const routeKeyOf = (definition: ModelDefinition): string =>
  definition.kind === 'collection'
    ? definition.pluralApiKey || suggestPlural(definition.apiKey)
    : definition.apiKey;

/** GraphQL list query of a collection (`articles(…)`): its plural API ID. */
export const collectionQueryName = (definition: ModelDefinition): string => routeKeyOf(definition);

/**
 * A stored definition with the plural API ID a collection gets when it predates them (the value
 * normalizing fills), and whether anything was filled. Callers that hash definitions re-hash when `filled`.
 */
export const withDerivedPlural = <T extends SchemaDefinition>(
  definition: T,
): { definition: T; filled: boolean } => {
  if (definition.kind !== 'collection' || definition.pluralApiKey) {
    return { definition, filled: false };
  }
  const { id, kind, apiKey, ...rest } = definition;
  const filled = { id, kind, apiKey, pluralApiKey: suggestPlural(apiKey), ...rest } as T;
  return { definition: filled, filled: true };
};

/**
 * GraphQL built-ins and the fixed types Shapio's schema always defines. Compared case-folded, so a model
 * called `string` (type `String`) or `pageInfo` is rejected.
 */
export const RESERVED_TYPE_NAMES: readonly string[] = [
  'Query',
  'Mutation',
  'Subscription',
  'String',
  'Int',
  'Float',
  'Boolean',
  'ID',
  'JSON',
  'Date',
  'DateTime',
  'Time',
  'Decimal',
  'BigInt',
  'RichText',
  'Media',
  'MediaAsset',
  'MediaVariant',
  'FocalPoint',
  'MediaKind',
  'Int53',
  'PageInfo',
  'Locale',
  'PublicationState',
  'SortDirection',
  'Node',
  'Entry',
  'Upload',
  'StringFilter',
  'IntFilter',
  'FloatFilter',
  'BooleanFilter',
  'IDFilter',
  'DateFilter',
  'DateTimeFilter',
  'TimeFilter',
  'DecimalFilter',
  'BigIntFilter',
  'JSONFilter',
  // The snapshot diff (`_changes`, `_snapshot`).
  'SnapshotChange',
  'SnapshotChangeKind',
  'SnapshotChangeLocale',
  'SnapshotChangePage',
  'SnapshotInfo',
  // The site and its SEO defaults (`_site`).
  'SiteInfo',
  'SiteSeoDefaults',
  'SiteSeoLocale',
];

/**
 * Model and component API keys the admin uses as static URL segments (`/content/new`,
 * `/develop/components`), so a type with one of these keys could not be opened. Compared case-folded.
 */
export const RESERVED_DEFINITION_API_KEYS: readonly string[] = ['new', 'components'];

/**
 * Field API keys that collide with the system fields every entry exposes in REST and GraphQL.
 * Compared case-folded.
 */
export const RESERVED_FIELD_API_KEYS: readonly string[] = [
  'id',
  'locale',
  'localizations',
  'status',
  'version',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'publicationState',
  // Logical operators of every model's GraphQL filter input (`XFilter`), next to the field keys.
  'and',
  'or',
  'not',
];

/**
 * Root query fields every GraphQL schema has, whatever models exist. Compared case-folded. The first is the
 * schema version field (schemaBuilder.ts reads it by position).
 */
export const RESERVED_QUERY_NAMES: readonly string[] = ['_schemaVersion', '_changes', '_snapshot', '_site'];

export type NameNamespace = 'type' | 'query' | 'mutation';

export type GeneratedName = {
  namespace: NameNamespace;
  name: string;
  /** Which definition (and field, for per-field types) produced the name, for error messages. */
  definitionId: string;
  fieldId?: string;
  /** The definition property the name comes from, when not `apiKey` (for the issue path). */
  property?: 'pluralApiKey';
};

/** Every name a definition contributes to the GraphQL schema. */
export const generatedNames = (definition: SchemaDefinition): GeneratedName[] => {
  const typeName = toTypeName(definition.apiKey);
  const definitionId = definition.id;
  const suffixes = definition.kind === 'component' ? COMPONENT_TYPE_SUFFIXES : MODEL_TYPE_SUFFIXES;
  const names: GeneratedName[] = suffixes.map((suffix) => ({
    namespace: 'type',
    name: `${typeName}${suffix}`,
    definitionId,
  }));
  for (const field of definition.fields) {
    const fieldType = `${typeName}${toTypeName(field.apiKey)}`;
    if (field.type === 'enum') {
      names.push({ namespace: 'type', name: `${fieldType}Enum`, definitionId, fieldId: field.id });
    }
    if (field.type === 'dynamiczone') {
      names.push({ namespace: 'type', name: `${fieldType}Zone`, definitionId, fieldId: field.id });
      names.push({ namespace: 'type', name: `${fieldType}ZoneInput`, definitionId, fieldId: field.id });
    }
  }
  if (definition.kind !== 'component') {
    names.push({ namespace: 'query', name: definition.apiKey, definitionId });
    // Only collections have a list query, so switching a singleton to a collection adds a name; the
    // switch is validated against the whole schema like any other change.
    if (definition.kind === 'collection') {
      names.push({
        namespace: 'query',
        name: collectionQueryName(definition),
        definitionId,
        property: 'pluralApiKey',
      });
    }
    for (const prefix of MUTATION_PREFIXES) {
      names.push({ namespace: 'mutation', name: `${prefix}${typeName}`, definitionId });
    }
  }
  return names;
};
