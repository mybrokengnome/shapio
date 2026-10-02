import {
  type COMPONENT_TYPE_SUFFIXES,
  type MODEL_TYPE_SUFFIXES,
  type MUTATION_PREFIXES,
  toTypeName,
  type FieldDefinition,
  type SchemaDefinition,
} from '@shapio/schema';

/**
 * Every per-definition GraphQL name, derived only from `@shapio/schema` `validators/naming.ts` (ADR 0002:
 * the registry validator rejects collisions against exactly these names at modelling time).
 */
type ModelSuffix = (typeof MODEL_TYPE_SUFFIXES)[number];
type ComponentSuffix = (typeof COMPONENT_TYPE_SUFFIXES)[number];
export type MutationPrefix = (typeof MUTATION_PREFIXES)[number];

export const modelTypeName = (definition: SchemaDefinition, suffix: ModelSuffix = ''): string =>
  `${toTypeName(definition.apiKey)}${suffix}`;

export const componentTypeName = (definition: SchemaDefinition, suffix: ComponentSuffix = ''): string =>
  `${toTypeName(definition.apiKey)}${suffix}`;

/** `<Type><Field>Enum`, `<Type><Field>Zone`, `<Type><Field>ZoneInput` (per-field types). */
export const fieldTypeName = (
  definition: SchemaDefinition,
  field: FieldDefinition,
  suffix: 'Enum' | 'Zone' | 'ZoneInput',
): string => `${toTypeName(definition.apiKey)}${toTypeName(field.apiKey)}${suffix}`;

/** `page(…)`: one entry (by ID for collections; the entry of a singleton). */
export const singleQueryName = (definition: SchemaDefinition): string => definition.apiKey;

/** `pages(…)`: a page of a collection, named by its plural API ID (`@shapio/schema` `collectionQueryName`). */
export { collectionQueryName } from '@shapio/schema';

export const mutationName = (prefix: MutationPrefix, definition: SchemaDefinition): string =>
  `${prefix}${toTypeName(definition.apiKey)}`;
