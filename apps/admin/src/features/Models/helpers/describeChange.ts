import type { ChangeKind, ClassifiedChange, DataType, SchemaDefinition } from '@shapio/schema';
import { i18next } from '@/app/i18n';
import { propertyLabel } from './labels';

/** Translation key per change kind; toggles add the `on`/`off` context (`…_on`, `…_off`). */
const CHANGE_KEYS = {
  'definition.added': 'models.changes.definitionAdded',
  'definition.removed': 'models.changes.definitionRemoved',
  'definition.apiKey': 'models.changes.definitionApiKey',
  'definition.pluralApiKey': 'models.changes.definitionPluralApiKey',
  'definition.metadata': 'models.changes.definitionMetadata',
  'model.kind': 'models.changes.modelKind',
  'model.localized': 'models.changes.modelLocalized',
  'model.draftAndPublish': 'models.changes.modelDraftAndPublish',
  'model.extends': 'models.changes.modelExtends',
  'field.added': 'models.changes.fieldAdded',
  'field.removed': 'models.changes.fieldRemoved',
  'field.order': 'models.changes.fieldOrder',
  'field.apiKey': 'models.changes.fieldApiKey',
  'field.metadata': 'models.changes.fieldMetadata',
  'field.editor': 'models.changes.fieldEditor',
  'field.type': 'models.changes.fieldType',
  'field.required': 'models.changes.fieldRequired',
  'field.localized': 'models.changes.fieldLocalized',
  'field.public': 'models.changes.fieldPublic',
  'field.deprecated': 'models.changes.fieldDeprecated',
  'field.unique': 'models.changes.fieldUnique',
  'field.filterable': 'models.changes.fieldFilterable',
  'field.sortable': 'models.changes.fieldSortable',
  'field.settings': 'models.changes.fieldSettings',
} as const satisfies Record<ChangeKind, string>;

const TOGGLES: ReadonlySet<ChangeKind> = new Set([
  'model.localized',
  'model.draftAndPublish',
  'field.required',
  'field.localized',
  'field.public',
  'field.deprecated',
  'field.unique',
  'field.filterable',
  'field.sortable',
]);

const TYPE_CHANGE_KINDS: ReadonlySet<ChangeKind> = new Set(['field.type', 'field.added']);

/** Old and new values are shown only when they are short scalars (labels, keys), never as JSON. */
const scalarText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';

const dataTypeName = (type: unknown) =>
  typeof type === 'string' ? i18next.t(`models.dataTypes.${type as DataType}.name`) : '';

/** Field label by ID, from the proposed definition or (for removed fields) the current one. */
export const fieldLabelOf = (
  fieldId: string | undefined,
  before: SchemaDefinition | null,
  after: SchemaDefinition | null,
): string => {
  const field =
    after?.fields.find((candidate) => candidate.id === fieldId) ??
    before?.fields.find((candidate) => candidate.id === fieldId);
  return field?.label ?? fieldId ?? '';
};

/** What a sentence may look up besides the two definitions. */
export type DescribeContext = {
  /** A model's name by stable ID (e.g. from the definitions cache); IDs are never shown in its place. */
  definitionName?: (id: string) => string | undefined;
};

const nameOf = (id: unknown, context: DescribeContext): string | undefined =>
  typeof id === 'string' ? context.definitionName?.(id) : undefined;

/**
 * "Make this a kind of Products", "Move this from Products to Media", "Stop being a kind of Products", by
 * the parents' names; without them, a sentence that names neither (a stable ID means nothing to a person).
 */
const describeExtends = (change: ClassifiedChange, context: DescribeContext): string => {
  const from = nameOf(change.from, context);
  const to = nameOf(change.to, context);
  const hasFrom = typeof change.from === 'string';
  const hasTo = typeof change.to === 'string';
  if ((hasFrom && from === undefined) || (hasTo && to === undefined)) {
    return i18next.t('models.changes.modelExtends');
  }
  const move = hasFrom ? (hasTo ? 'moved' : 'removed') : 'added';
  return i18next.t('models.changes.modelExtends', { context: move, from, to });
};

/** One sentence describing a planned change, e.g. "Rename the API key of Title from title to headline". */
export const describeChange = (
  change: ClassifiedChange,
  before: SchemaDefinition | null,
  after: SchemaDefinition | null,
  context: DescribeContext = {},
): string => {
  if (change.kind === 'model.extends') {
    return describeExtends(change, context);
  }
  const field = fieldLabelOf(change.fieldId, before, after);
  const addedType =
    change.kind === 'field.added' && typeof change.to === 'object' && change.to !== null
      ? (change.to as { type?: unknown }).type
      : undefined;
  const values = TYPE_CHANGE_KINDS.has(change.kind)
    ? { from: dataTypeName(change.from), to: dataTypeName(change.to), type: dataTypeName(addedType) }
    : { from: scalarText(change.from), to: scalarText(change.to) };
  // A type change Shapio can't convert says that the field's stored values are dropped.
  const key = change.dropsValues ? 'models.changes.fieldTypeDropped' : CHANGE_KEYS[change.kind];
  return i18next.t(key, {
    field,
    name: after?.label ?? before?.label ?? '',
    property: change.property ? propertyLabel(change.property) : '',
    ...values,
    ...(TOGGLES.has(change.kind) ? { context: change.to === true ? 'on' : 'off' } : {}),
  });
};
