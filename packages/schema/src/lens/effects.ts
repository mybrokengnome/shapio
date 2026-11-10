import type { ClassifiedChange } from '../diff/classify.js';
import type { ChangeKind } from '../diff/types.js';
import type { DataType } from '../types/dataTypes.js';
import type { FieldDefinition } from '../types/definitions.js';
import { RICHTEXT_FORMAT_VERSION } from '../types/valueFormats.js';
import { LENS_EFFECTS, type DefinitionLens, type FieldLens, type LensEffect } from './types.js';

const rank = (effect: LensEffect) => LENS_EFFECTS.indexOf(effect);
const worst = (effects: readonly LensEffect[]): LensEffect =>
  effects.reduce<LensEffect>((a, b) => (rank(b) > rank(a) ? b : a), 'transparent');

const TEXT_TYPES: ReadonlySet<DataType> = new Set(['string', 'text']);
const NUMBER_TYPES: ReadonlySet<DataType> = new Set(['number', 'integer']);

/**
 * Whether every value of type `from` survives conversion to `to` (a client reading `from` storage as `to`):
 * a widening. Anything else may leave some values null. Text read as rich text is a document of the current
 * format version: lossless only for a client on that version (`richTextFits`).
 */
const typeConvertsLosslessly = (from: DataType, to: DataType): boolean =>
  (from === 'integer' && to === 'number') ||
  (from === 'biginteger' && to === 'decimal') ||
  (NUMBER_TYPES.has(from) && (TEXT_TYPES.has(to) || to === 'decimal')) ||
  (from === 'boolean' && TEXT_TYPES.has(to)) ||
  (TEXT_TYPES.has(from) && TEXT_TYPES.has(to)) ||
  (TEXT_TYPES.has(from) && to === 'richtext');

const enumValuesFit = (stored: FieldDefinition, client: FieldDefinition): boolean => {
  if (stored.type !== 'enum' || client.type !== 'enum') {
    return false;
  }
  const allowed = new Set(client.settings.values.map((entry) => entry.value));
  return stored.settings.values.every((entry) => allowed.has(entry.value));
};

const richTextFits = (client: FieldDefinition): boolean =>
  client.type !== 'richtext' || client.settings.formatVersion === RICHTEXT_FORMAT_VERSION;

/**
 * A single value read by a list client keeps it (one-item list); a list read by a single client may not. An
 * enum keeps it only when every value it allows is one the client allows too.
 */
const becomesList = (stored: FieldDefinition, client: FieldDefinition): boolean => {
  if (stored.type !== client.type) {
    return false;
  }
  switch (client.type) {
    case 'enum':
      return (
        client.settings.multiple &&
        !(stored as FieldDefinition<'enum'>).settings.multiple &&
        enumValuesFit(stored, client)
      );
    case 'media':
      return client.settings.multiple && !(stored as FieldDefinition<'media'>).settings.multiple;
    case 'relation':
      return (
        client.settings.cardinality === 'many' &&
        (stored as FieldDefinition<'relation'>).settings.cardinality === 'one' &&
        (stored as FieldDefinition<'relation'>).settings.target === client.settings.target
      );
    case 'component':
      return client.settings.repeatable && !(stored as FieldDefinition<'component'>).settings.repeatable;
    default:
      return false;
  }
};

/** The components whose instances a container field (component, zone) shows: allowed then and now. */
const shownComponents = (lens: FieldLens & { kind: 'same' | 'convert' }): Array<DefinitionLens | null> => {
  const { client, stored } = lens;
  if (client.type === 'dynamiczone') {
    const today = new Set(stored.type === 'dynamiczone' ? stored.settings.components : []);
    return client.settings.components
      .filter((id) => today.has(id))
      .map((id) => lens.nested?.components.get(id) ?? null);
  }
  return [...(lens.nested?.components.values() ?? [])];
};

/**
 * A container field (component, repeatable component, zone) takes the worst effect inside it, but a field
 * read empty inside it (`nulled`) leaves the container with its instances: `lossy`. Only a container no
 * instance of which can be read (every component it shows gone, or none it may show) reads empty: `nulled`.
 * Instances of a component that cannot be read, beside ones that can, drop out: `lossy`.
 */
const nestedEffect = (lens: FieldLens): LensEffect => {
  if (lens.kind === 'null' || (lens.client.type !== 'component' && lens.client.type !== 'dynamiczone')) {
    return 'transparent';
  }
  const shown = shownComponents(lens);
  const readable = shown.filter(
    (nested): nested is DefinitionLens => nested !== null && nested.status !== 'gone',
  );
  if (readable.length === 0) {
    return 'nulled';
  }
  const inside = readable.map((nested) => {
    const effect = definitionEffect(nested);
    return effect === 'nulled' ? 'lossy' : effect;
  });
  const dropped = readable.length < shown.length ? ['lossy' as const] : [];
  return worst([...inside, ...dropped]);
};

/**
 * Visibility is today's (ADR 0015): a field deprecated since the client's version reads empty for every reader,
 * and one the client's version delivered publicly that is private now reads empty for every delivery reader
 * whose role does not name it.
 */
const hiddenSince = (lens: FieldLens): boolean =>
  lens.kind !== 'null' &&
  !lens.client.deprecated &&
  (lens.stored.deprecated || (lens.client.public && !lens.stored.public));

const fieldEffect = (lens: FieldLens): LensEffect => {
  if (hiddenSince(lens)) {
    return 'nulled';
  }
  switch (lens.kind) {
    case 'null':
      return 'nulled';
    case 'same':
      return nestedEffect(lens);
    case 'convert': {
      const { stored, client } = lens;
      const lossless =
        stored.type === client.type
          ? becomesList(stored, client) ||
            (client.type === 'enum' &&
              enumValuesFit(stored, client) &&
              (stored as FieldDefinition<'enum'>).settings.multiple === client.settings.multiple)
          : typeConvertsLosslessly(stored.type, client.type) && richTextFits(client);
      return worst([lossless ? 'converted' : 'lossy', nestedEffect(lens)]);
    }
  }
};

const definitionEffect = (lens: DefinitionLens): LensEffect => {
  if (lens.status === 'gone' || lens.status === 'uncovered') {
    return lens.status;
  }
  return worst(lens.fields.map(fieldEffect));
};

/**
 * The effect of a lens on each field of the client's definition (a component or dynamic-zone field takes the
 * worst effect inside it). A gone or uncovered definition marks every field so. This is the composite over
 * every change between the two versions, which is what a review reports per client version.
 */
export const lensEffects = (lens: DefinitionLens): ReadonlyArray<{ fieldId: string; effect: LensEffect }> =>
  lens.fields.map((field) => ({
    fieldId: field.fieldId,
    effect: lens.status === 'gone' || lens.status === 'uncovered' ? lens.status : fieldEffect(field),
  }));

/** The effect of a lens on its definition as a whole: the worst of its fields. */
export const lensDefinitionEffect = (lens: DefinitionLens): LensEffect => definitionEffect(lens);

const asStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) =>
        typeof entry === 'object' && entry !== null
          ? String((entry as { value?: unknown }).value)
          : String(entry),
      )
    : [];

/** Adding to an allowed set (enum values, dynamic-zone components) shows the old client values it cannot read. */
const addsAny = (from: unknown, to: unknown): boolean => {
  const before = new Set(asStrings(from));
  return asStrings(to).some((entry) => !before.has(entry));
};

const settingsEffect = (change: ClassifiedChange): LensEffect => {
  if (change.dropsValues) {
    return 'nulled';
  }
  switch (change.property) {
    case 'multiple':
    case 'repeatable':
    case 'cardinality':
      // To single: the old (list) client reads a one-item list. To a list: the old client reads the first item.
      return change.to === false || change.to === 'one' ? 'converted' : 'lossy';
    case 'target':
      // A widened target keeps its values; entries outside the old target drop out of the old client's view.
      return 'lossy';
    case 'component':
      return 'nulled';
    case 'values':
    case 'components':
      return addsAny(change.from, change.to) ? 'lossy' : 'transparent';
    case 'formatVersion':
      return 'uncovered';
    default:
      return 'transparent';
  }
};

const typeEffect = (change: ClassifiedChange): LensEffect => {
  if (change.dropsValues) {
    return 'nulled';
  }
  // The old client reads the new type converted back to the old one.
  return typeConvertsLosslessly(change.to as DataType, change.from as DataType) ? 'converted' : 'lossy';
};

const EFFECT_OF_KIND: Readonly<Record<ChangeKind, LensEffect | ((change: ClassifiedChange) => LensEffect)>> =
  {
    'definition.added': 'transparent',
    'definition.removed': 'gone',
    'definition.apiKey': 'transparent',
    'definition.pluralApiKey': 'transparent',
    'definition.metadata': 'transparent',
    'model.kind': 'uncovered',
    'model.localized': 'uncovered',
    'model.draftAndPublish': 'uncovered',
    // A marker: the fields gained or lost come as field changes of the resolved definitions.
    'model.extends': 'transparent',
    // The client's view keeps the interfaces it knew; entries of new members are not in it.
    'model.implements': 'transparent',
    'field.added': 'transparent',
    'field.removed': 'nulled',
    'field.order': 'transparent',
    'field.apiKey': 'transparent',
    'field.metadata': 'transparent',
    'field.editor': 'transparent',
    'field.type': typeEffect,
    'field.required': 'transparent',
    'field.localized': 'uncovered',
    // Visibility is today's: a field made private reads null through every lens.
    'field.public': (change) => (change.to === false ? 'nulled' : 'transparent'),
    // Deprecated hides a field from every reader through every lens, as `public` off does.
    'field.deprecated': (change) => (change.to === true ? 'nulled' : 'transparent'),
    'field.unique': 'transparent',
    // Queries run on today's storage: a filter or sort the field no longer allows is refused, not hidden.
    'field.filterable': (change) => (change.to === false ? 'uncovered' : 'transparent'),
    'field.sortable': (change) => (change.to === false ? 'uncovered' : 'transparent'),
    'field.settings': settingsEffect,
  };

/**
 * What one change means for a client on the version before it (CLI `schema diff` wording). For a client
 * several versions back, compute `lensEffects(compileLens(...))` instead: effects compose.
 */
export const lensEffectOfChange = (change: ClassifiedChange): LensEffect => {
  const effect = EFFECT_OF_KIND[change.kind];
  return typeof effect === 'function' ? effect(change) : effect;
};
