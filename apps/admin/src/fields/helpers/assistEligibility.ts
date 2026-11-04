import type { FieldDefinition, ModelDefinition } from '@shapio/schema';

/** Field types assist can suggest a value for (the server's rule, services/assist/suggestTarget.ts). */
const SUGGESTIBLE_TYPES: ReadonlySet<string> = new Set(['string', 'text', 'enum']);

/**
 * Whether "Suggest" can fill a field at `path` (a JSON pointer in API IDs): a live string, text or enum
 * field of the entry itself (`/keywords`, the title included), or of a single, non-repeatable component
 * field (`/seo/title`). Repeatable components, dynamic zones and anything deeper are left out.
 */
export const isSuggestible = (model: ModelDefinition, field: FieldDefinition, path: string): boolean => {
  if (!SUGGESTIBLE_TYPES.has(field.type) || field.deprecated) {
    return false;
  }
  const segments = path.split('/').slice(1);
  if (segments.at(-1) !== field.apiKey) {
    return false;
  }
  if (segments.length === 1) {
    return model.fields.some((candidate) => candidate.id === field.id);
  }
  if (segments.length !== 2) {
    return false;
  }
  const parent = model.fields.find((candidate) => candidate.apiKey === segments[0]);
  return parent?.type === 'component' && !parent.settings.repeatable && !parent.deprecated;
};
