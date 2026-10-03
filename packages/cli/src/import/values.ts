import type { FieldDefinition, SchemaDefinition } from '@shapio/schema';
import type { ImportMap } from './importMap.js';
import type { ConversionWarning, SourceFields, SourceValue, ValueResolver } from './types.js';

/**
 * Entry data for the admin content API (keyed by API ID) from source values. Fields are found by the stable
 * IDs the plan assigned, through the live schema: renaming an API ID before applying is fine, and a planned
 * field the person deleted (or deprecated) is simply not imported.
 */
export type DefinitionView = { definition: SchemaDefinition; fields: Map<string, FieldDefinition> };

export type LiveSchema = {
  /** By planned definition key. */
  byKey: Map<string, DefinitionView>;
  /** By definition ID (component fields name their component by ID). */
  byId: Map<string, DefinitionView>;
  /** Planned definitions the instance does not have. */
  missing: string[];
};

export const resolveLiveSchema = (map: ImportMap, definitions: readonly SchemaDefinition[]): LiveSchema => {
  const live = new Map(definitions.map((definition) => [definition.id, definition]));
  const byKey = new Map<string, DefinitionView>();
  const byId = new Map<string, DefinitionView>();
  const missing: string[] = [];
  for (const [key, planned] of Object.entries(map.definitions)) {
    const definition = live.get(planned.id);
    if (!definition) {
      missing.push(planned.apiKey);
      continue;
    }
    const fieldsById = new Map(definition.fields.map((field) => [field.id, field]));
    const fields = new Map<string, FieldDefinition>();
    for (const [fieldKey, fieldId] of Object.entries(planned.fields)) {
      const field = fieldsById.get(fieldId);
      if (field && !field.deprecated) {
        fields.set(fieldKey, field);
      }
    }
    const view = { definition, fields };
    byKey.set(key, view);
    byId.set(definition.id, view);
  }
  return { byKey, byId, missing };
};

export type BuildContext = {
  live: LiveSchema;
  resolver: ValueResolver;
  warnings: ConversionWarning[];
};

export type FieldSelection = {
  /** Top-level field keys to leave out (deferred references). */
  omit?: ReadonlySet<string>;
  /** Only these top-level field keys (writing deferred references). */
  only?: ReadonlySet<string>;
  /** Only localized fields (a second locale of an entry: shared fields were written with the first). */
  localizedOnly?: boolean;
};

const resolveIds = (
  sourceIds: readonly string[],
  lookup: (sourceId: string) => string | undefined,
  code: string,
  context: BuildContext,
): string[] =>
  sourceIds.flatMap((sourceId) => {
    const id = lookup(sourceId);
    if (!id) {
      context.warnings.push({ code, detail: sourceId });
      return [];
    }
    return [id];
  });

const listOrOne = (ids: readonly string[], many: boolean): unknown =>
  many ? (ids.length > 0 ? ids : undefined) : ids[0];

const componentView = (field: FieldDefinition, context: BuildContext) =>
  field.type === 'component' ? context.live.byId.get(field.settings.component) : undefined;

const convertValue = (value: SourceValue, field: FieldDefinition, context: BuildContext): unknown => {
  switch (value.kind) {
    case 'scalar':
      return value.value;
    case 'entries':
      return listOrOne(
        resolveIds(value.sourceIds, context.resolver.entry, 'missingReference', context),
        value.many,
      );
    case 'media':
      return listOrOne(
        resolveIds(value.sourceIds, context.resolver.media, 'missingMedia', context),
        value.many,
      );
    case 'richtext': {
      const converted = value.convert(context.resolver);
      context.warnings.push(...converted.warnings);
      return converted.document;
    }
    case 'component': {
      const view = componentView(field, context);
      if (!view) {
        return undefined;
      }
      const items = value.items.map((item) => buildData(item, view, context));
      return value.many ? items : items[0];
    }
    case 'zone':
      return value.items.flatMap((item) => {
        const view = context.live.byKey.get(item.component);
        return view
          ? [{ __component: view.definition.apiKey, ...buildData(item.fields, view, context) }]
          : [];
      });
    default:
      return undefined;
  }
};

/** The data object for one locale of an entry (or one component item). */
export const buildData = (
  fields: SourceFields,
  view: DefinitionView,
  context: BuildContext,
  selection: FieldSelection = {},
): Record<string, unknown> => {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const field = view.fields.get(key);
    if (
      !field ||
      selection.omit?.has(key) ||
      (selection.only && !selection.only.has(key)) ||
      (selection.localizedOnly && !field.localized)
    ) {
      continue;
    }
    const converted = convertValue(value, field, context);
    if (converted !== undefined && converted !== null) {
      data[field.apiKey] = converted;
    }
  }
  return data;
};
