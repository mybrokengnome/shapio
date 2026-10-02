/**
 * Turns the JSON Schema of a settings or editor-options object (TypeBox, from @shapio/schema) into form
 * controls, so the builder renders exactly the properties the server validates and never redefines them.
 */
type JsonSchema = {
  type?: string;
  enum?: readonly unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
};

export type PropertyControl =
  | { kind: 'boolean' }
  | { kind: 'integer'; minimum?: number; maximum?: number }
  | { kind: 'number'; minimum?: number }
  | { kind: 'text'; maxLength?: number }
  | { kind: 'choice'; options: string[] }
  | { kind: 'choices'; options: string[] }
  | { kind: 'textList' }
  | { kind: 'other' };

export type DescribedProperty = { key: string; control: PropertyControl; required: boolean };

const enumOptions = (schema: JsonSchema | undefined): string[] | undefined =>
  schema?.enum?.every((value) => typeof value === 'string') ? (schema.enum as string[]) : undefined;

export const describeControl = (schema: JsonSchema): PropertyControl => {
  const options = enumOptions(schema);
  if (options) {
    return { kind: 'choice', options };
  }
  switch (schema.type) {
    case 'boolean':
      return { kind: 'boolean' };
    case 'integer':
      return {
        kind: 'integer',
        ...(schema.minimum !== undefined ? { minimum: schema.minimum } : {}),
        ...(schema.maximum !== undefined ? { maximum: schema.maximum } : {}),
      };
    case 'number':
      return { kind: 'number', ...(schema.minimum !== undefined ? { minimum: schema.minimum } : {}) };
    case 'string':
      return { kind: 'text', ...(schema.maxLength !== undefined ? { maxLength: schema.maxLength } : {}) };
    case 'array': {
      const itemOptions = enumOptions(schema.items);
      if (itemOptions) {
        return { kind: 'choices', options: itemOptions };
      }
      return schema.items?.type === 'string' ? { kind: 'textList' } : { kind: 'other' };
    }
    default:
      return { kind: 'other' };
  }
};

/** The properties of an object schema, in declaration order. */
export const describeProperties = (schema: unknown): DescribedProperty[] => {
  const object = schema as JsonSchema;
  const required = new Set(object.required ?? []);
  return Object.entries(object.properties ?? {}).map(([key, property]) => ({
    key,
    control: describeControl(property),
    required: required.has(key),
  }));
};
