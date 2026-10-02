import type { DefinitionCategory } from '@shapio/client';
import { ComponentDefinitionInputSchema, ModelDefinitionInputSchema, SETTINGS_SCHEMAS } from '@shapio/schema';

/**
 * The JSON Schema behind the editor's completion and hover: the definition input schemas from
 * `@shapio/schema` (TypeBox, so already JSON Schema), with each field's `settings` narrowed to its data
 * type's settings schema. Validation is not taken from here: the semantic linter runs the server's own
 * validators (`parseDefinition`, `validateSchema`), so messages match the API and the CLI.
 */
/** The subset of JSON Schema the TypeBox definition schemas use (what completion and hover read). */
export type JSONSchema7 = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JSONSchema7>;
  required?: string[];
  items?: JSONSchema7 | JSONSchema7[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: JSONSchema7[];
  oneOf?: JSONSchema7[];
  allOf?: JSONSchema7[];
  if?: JSONSchema7;
  then?: JSONSchema7;
  patternProperties?: Record<string, JSONSchema7>;
  additionalProperties?: boolean | JSONSchema7;
};

const plain = (schema: unknown): JSONSchema7 => JSON.parse(JSON.stringify(schema)) as JSONSchema7;

const withTypedSettings = (schema: JSONSchema7): JSONSchema7 => {
  const field = schema.properties?.fields?.items;
  if (field && !Array.isArray(field)) {
    field.allOf = Object.entries(SETTINGS_SCHEMAS).map(([type, settings]) => ({
      if: { properties: { type: { const: type } }, required: ['type'] },
      then: { properties: { settings: plain(settings) } },
    }));
  }
  return schema;
};

const SCHEMAS: Record<DefinitionCategory, JSONSchema7> = {
  model: withTypedSettings(plain(ModelDefinitionInputSchema)),
  component: withTypedSettings(plain(ComponentDefinitionInputSchema)),
};

export const editorSchemaFor = (category: DefinitionCategory): JSONSchema7 => SCHEMAS[category];
