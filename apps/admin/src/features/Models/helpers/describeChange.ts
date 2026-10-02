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

/** One sentence describing a planned change, e.g. "Rename the API key of Title from title to headline". */
export const describeChange = (
  change: ClassifiedChange,
  before: SchemaDefinition | null,
  after: SchemaDefinition | null,
): string => {
  const field = fieldLabelOf(change.fieldId, before, after);
  const addedType =
    change.kind === 'field.added' && typeof change.to === 'object' && change.to !== null
      ? (change.to as { type?: unknown }).type
      : undefined;
  const values = TYPE_CHANGE_KINDS.has(change.kind)
    ? { from: dataTypeName(change.from), to: dataTypeName(change.to), type: dataTypeName(addedType) }
    : { from: scalarText(change.from), to: scalarText(change.to) };
  return i18next.t(CHANGE_KEYS[change.kind], {
    field,
    name: after?.label ?? before?.label ?? '',
    property: change.property ? propertyLabel(change.property) : '',
    ...values,
    ...(TOGGLES.has(change.kind) ? { context: change.to === true ? 'on' : 'off' } : {}),
  });
};
