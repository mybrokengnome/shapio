import { storageFamilyOf, type StorageFamily } from '../types/dataTypes.js';
import {
  isComponentDefinition,
  isInterfaceDefinition,
  type FieldDefinition,
  type SchemaDefinition,
} from '../types/definitions.js';
import { routeKeyOf } from '../validators/naming.js';
import type { DefinitionLens, FieldLens, LensSide, NestedLens } from './types.js';

/** A definition's effective form: a model with its inherited fields, anything else as stored. */
const effective = (side: LensSide, id: string): SchemaDefinition | undefined =>
  side.resolve(id) ?? side.get(id);

const routeOf = (definition: SchemaDefinition): string | null =>
  isComponentDefinition(definition) ? null : routeKeyOf(definition);

/** Whether a client field holds a list (it reads `[]` when empty). */
export const isListValuedField = (field: FieldDefinition): boolean =>
  (field.type === 'relation' && field.settings.cardinality === 'many') ||
  (field.type === 'media' && field.settings.multiple) ||
  (field.type === 'component' && field.settings.repeatable) ||
  (field.type === 'enum' && field.settings.multiple) ||
  field.type === 'dynamiczone';

const isSubset = (inner: readonly string[], outer: readonly string[]) => {
  const allowed = new Set(outer);
  return inner.every((value) => allowed.has(value));
};

/**
 * Whether every value stored under `stored` is valid for `client` as it is. Only what changes a value's API
 * shape counts: list or single, relation target, component, enum values, allowed components, rich-text format.
 * Length, range and pattern rules are validation, not shape: a client reads a stored value either way.
 */
export const storedValuesFitClient = (stored: FieldDefinition, client: FieldDefinition): boolean => {
  if (stored.type !== client.type) {
    return false;
  }
  switch (client.type) {
    case 'enum': {
      const from = stored as FieldDefinition<'enum'>;
      return (
        from.settings.multiple === client.settings.multiple &&
        isSubset(
          from.settings.values.map((entry) => entry.value),
          client.settings.values.map((entry) => entry.value),
        )
      );
    }
    case 'media':
      return (stored as FieldDefinition<'media'>).settings.multiple === client.settings.multiple;
    case 'relation': {
      const from = stored as FieldDefinition<'relation'>;
      return (
        from.settings.target === client.settings.target &&
        from.settings.cardinality === client.settings.cardinality
      );
    }
    case 'component': {
      const from = stored as FieldDefinition<'component'>;
      return (
        from.settings.component === client.settings.component &&
        from.settings.repeatable === client.settings.repeatable
      );
    }
    case 'dynamiczone':
      return isSubset(
        (stored as FieldDefinition<'dynamiczone'>).settings.components,
        client.settings.components,
      );
    case 'richtext':
      return (stored as FieldDefinition<'richtext'>).settings.formatVersion === client.settings.formatVersion;
    default:
      return true;
  }
};

const TEXT_TARGET_FAMILIES: ReadonlySet<StorageFamily> = new Set([
  'jsonString',
  'jsonNumber',
  'numericString',
  'boolean',
  'richtext',
]);

/**
 * Whether some value stored under `stored` can be read as the client's type, by the read-side conversions
 * (`convertType` and list/single). Within one storage family the stored JSON stays as it is. Unlike the
 * planner's `typeChangeDropsValues` (one direction, every value must convert), this asks whether any value
 * can: the read re-checks each value and shows null where one does not fit.
 */
export const lensCanRead = (stored: FieldDefinition, client: FieldDefinition): boolean => {
  const from = storageFamilyOf(stored);
  const to = storageFamilyOf(client);
  if (from === to) {
    return true;
  }
  switch (client.type) {
    case 'string':
    case 'text':
      return TEXT_TARGET_FAMILIES.has(from);
    case 'number':
    case 'integer':
      return from === 'jsonString' || from === 'numericString';
    case 'decimal':
    case 'biginteger':
      return from === 'jsonNumber' || from === 'jsonString';
    case 'richtext':
      return from === 'jsonString' && stored.type !== 'code';
    case 'enum':
      return from === 'jsonString' || from === 'jsonStringArray';
    case 'code':
    case 'slug':
    case 'email':
    case 'url':
    case 'uid':
    case 'date':
    case 'datetime':
    case 'time':
      return from === 'numericString';
    default:
      return false;
  }
};

type Compiler = {
  stored: LensSide;
  client: LensSide;
  /** Lenses compiled in this call, by definition ID (shared components compile once; cycles end here). */
  memo: Map<string, DefinitionLens | null>;
};

/** The client-side component IDs a component or dynamic-zone field holds. */
const heldComponents = (field: FieldDefinition): string[] => {
  if (field.type === 'component') {
    return [field.settings.component];
  }
  return field.type === 'dynamiczone' ? [...field.settings.components] : [];
};

const nestedLens = (compiler: Compiler, field: FieldDefinition): NestedLens | undefined => {
  const ids = heldComponents(field);
  if (ids.length === 0) {
    return undefined;
  }
  return { components: new Map(ids.map((id) => [id, compileInto(compiler, id)])) };
};

const fieldLens = (
  compiler: Compiler,
  client: FieldDefinition,
  stored: FieldDefinition | undefined,
): FieldLens => {
  const base = { fieldId: client.id, apiKey: client.apiKey, client };
  const nullLens = (
    reason: 'removed' | 'dropped' | 'componentChanged',
    from: FieldDefinition | null,
  ): FieldLens => ({
    ...base,
    kind: 'null',
    stored: from,
    list: isListValuedField(client),
    reason,
  });
  if (!stored) {
    return nullLens('removed', null);
  }
  if (
    client.type === 'component' &&
    (stored.type !== 'component' || stored.settings.component !== client.settings.component)
  ) {
    return nullLens('componentChanged', stored);
  }
  if (!lensCanRead(stored, client)) {
    return nullLens('dropped', stored);
  }
  const nested = nestedLens(compiler, client);
  return {
    ...base,
    kind: storedValuesFitClient(stored, client) ? 'same' : 'convert',
    stored,
    ...(nested ? { nested } : {}),
  };
};

const isIdentityField = (lens: FieldLens): boolean =>
  lens.kind === 'same' &&
  lens.stored.apiKey === lens.apiKey &&
  [...(lens.nested?.components.values() ?? [])].every((nested) => nested?.status === 'identity');

const compileInto = (compiler: Compiler, definitionId: string): DefinitionLens | null => {
  if (compiler.memo.has(definitionId)) {
    return compiler.memo.get(definitionId) ?? null;
  }
  const client = effective(compiler.client, definitionId);
  if (!client) {
    compiler.memo.set(definitionId, null);
    return null;
  }
  const stored = effective(compiler.stored, definitionId);
  const apiKeyToFieldId = new Map(client.fields.map((field) => [field.apiKey, field.id]));
  if (!stored) {
    const gone: DefinitionLens = {
      definitionId,
      status: 'gone',
      apiKey: client.apiKey,
      storedApiKey: null,
      fields: client.fields.map((field) => fieldLens(compiler, field, undefined)),
      apiKeyToFieldId,
      addedFieldIds: [],
    };
    compiler.memo.set(definitionId, gone);
    return gone;
  }
  // Placeholder while the fields compile, so a component that (invalidly) holds itself ends the recursion.
  const lens: { -readonly [K in keyof DefinitionLens]: DefinitionLens[K] } = {
    definitionId,
    status: 'lensed',
    apiKey: client.apiKey,
    storedApiKey: stored.apiKey,
    fields: [],
    apiKeyToFieldId,
    addedFieldIds: stored.fields
      .filter((field) => !client.fields.some((known) => known.id === field.id))
      .map((field) => field.id),
  };
  compiler.memo.set(definitionId, lens);
  const storedFields = new Map(stored.fields.map((field) => [field.id, field]));
  lens.fields = client.fields.map((field) => fieldLens(compiler, field, storedFields.get(field.id)));
  const kindChanged =
    stored.kind !== client.kind && !isInterfaceDefinition(stored) && !isComponentDefinition(stored);
  if (kindChanged) {
    lens.status = 'uncovered';
  } else if (
    stored.kind === client.kind &&
    stored.apiKey === client.apiKey &&
    routeOf(stored) === routeOf(client) &&
    lens.fields.every(isIdentityField)
  ) {
    lens.status = 'identity';
  }
  return lens;
};

/**
 * The lens that reads definition `definitionId` as stored today (`stored`) in the shape the client knows
 * (`client`), with the lenses of every component it holds. null when the client does not know the definition
 * (a model created after its version): nothing of it may be shown. Pure; callers cache it by the two sides'
 * revisions (components included).
 */
export const compileLens = (
  stored: LensSide,
  client: LensSide,
  definitionId: string,
): DefinitionLens | null => compileInto({ stored, client, memo: new Map() }, definitionId);
