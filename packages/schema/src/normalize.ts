import { DEFAULT_EDITORS } from './editors/catalogue.js';
import { suggestPlural } from './naming/plural.js';
import type {
  ComponentDefinition,
  ComponentDefinitionInput,
  ComponentDisplay,
  FieldDefinition,
  FieldInput,
  ModelDefinition,
  ModelDefinitionInput,
  ModelDisplay,
  SchemaDefinition,
} from './types/definitions.js';
import type { JsonValue } from './types/json.js';
import { RICHTEXT_FORMAT_VERSION } from './types/valueFormats.js';

/** Input whose IDs have been assigned (see `assignIds`). */
type WithIds<T extends { id?: string }> = T & { id: string };
export type FieldInputWithId = WithIds<FieldInput>;
export type DefinitionInputWithIds =
  | (WithIds<ModelDefinitionInput> & { fields: FieldInputWithId[] })
  | (WithIds<ComponentDefinitionInput> & { fields: FieldInputWithId[] });

const SETTINGS_DEFAULTS: Partial<Record<FieldDefinition['type'], Record<string, unknown>>> = {
  code: { language: 'plain' },
  richtext: { formatVersion: RICHTEXT_FORMAT_VERSION },
  enum: { multiple: false },
  media: { multiple: false },
  component: { repeatable: false },
};

/** Optional text properties where an empty string means "not set". */
const OPTIONAL_TEXT_KEYS: ReadonlySet<string> = new Set([
  'description',
  'category',
  'icon',
  'titleFieldId',
  'coverFieldId',
  'pluralApiKey',
]);
/** Optional list properties where an empty list means "not set". `fields` is never optional. */
const OPTIONAL_LIST_KEYS: ReadonlySet<string> = new Set([
  'listFieldIds',
  'groups',
  'canvasFieldIds',
  'stripFieldIds',
]);

const withoutEmpty = <T extends Record<string, unknown>>(value: T): T => {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const isEmptyText = OPTIONAL_TEXT_KEYS.has(key) && entry === '';
    const isEmptyList = OPTIONAL_LIST_KEYS.has(key) && Array.isArray(entry) && entry.length === 0;
    if (entry === undefined || isEmptyText || isEmptyList) {
      continue;
    }
    result[key] = entry;
  }
  return result as T;
};

const normalizeField = (field: FieldInputWithId): FieldDefinition => {
  const normalized = {
    id: field.id,
    apiKey: field.apiKey,
    label: field.label,
    description: field.description,
    type: field.type,
    required: field.required ?? false,
    localized: field.localized ?? false,
    public: field.public ?? true,
    unique: field.unique ?? false,
    filterable: field.filterable ?? false,
    sortable: field.sortable ?? false,
    deprecated: field.deprecated ?? false,
    defaultValue: field.defaultValue as JsonValue | undefined,
    settings: { ...SETTINGS_DEFAULTS[field.type], ...field.settings },
    editor: {
      id: field.editor?.id ?? DEFAULT_EDITORS[field.type],
      options: (field.editor?.options ?? {}) as Record<string, JsonValue>,
    },
  };
  return withoutEmpty(normalized) as FieldDefinition;
};

const normalizeModelDisplay = (display: ModelDefinitionInput['display']): ModelDisplay =>
  withoutEmpty({ ...display });

const normalizeComponentDisplay = (display: ComponentDefinitionInput['display']): ComponentDisplay =>
  withoutEmpty({ ...display });

/**
 * Applies defaults so that two definitions meaning the same thing are byte-identical once serialized
 * canonically: a hand-written file that omits `public` hashes the same as one that says `public: true`.
 * Empty optional strings and arrays are dropped. A collection without a plural API ID gets the suggested
 * one (`suggestPlural`), so files and definitions from before plural API IDs keep working.
 */
export const normalizeDefinition = (input: DefinitionInputWithIds): SchemaDefinition => {
  const fields = input.fields.map(normalizeField);
  if (input.kind === 'component') {
    const component: ComponentDefinition = withoutEmpty({
      id: input.id,
      kind: 'component',
      apiKey: input.apiKey,
      label: input.label,
      description: input.description,
      category: input.category,
      icon: input.icon,
      fields,
      display: normalizeComponentDisplay(input.display),
    });
    return component;
  }
  const model: ModelDefinition = withoutEmpty({
    id: input.id,
    kind: input.kind,
    apiKey: input.apiKey,
    // Collections always carry a plural API ID (filled from the singular when missing or empty);
    // singletons never do, so switching a collection to a singleton drops it.
    pluralApiKey: input.kind === 'collection' ? input.pluralApiKey || suggestPlural(input.apiKey) : undefined,
    label: input.label,
    description: input.description,
    localized: input.localized ?? false,
    draftAndPublish: input.draftAndPublish ?? true,
    fields,
    display: normalizeModelDisplay(input.display),
  });
  return model;
};

/** Normalizes a definition that is already normalized-shaped (e.g. read back from the database). */
export const renormalizeDefinition = (definition: SchemaDefinition): SchemaDefinition =>
  normalizeDefinition(definition as unknown as DefinitionInputWithIds);
