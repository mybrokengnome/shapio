import { Type, type TSchema } from 'typebox';
import type { DataType } from '../types/dataTypes.js';
import type { FieldDefinition } from '../types/definitions.js';

/**
 * Built-in editors (ADR 0009): which data types each can edit and the schema of its options. The server
 * validates every field's editor choice against this catalogue, so selecting and configuring an editor is
 * runtime metadata. Custom editors (loaded at runtime from the project) use namespaced IDs containing a dot,
 * e.g. `acme.colorWheel`; their options are free-form JSON here because their schema lives in the project.
 */
export type EditorCatalogueEntry = {
  id: string;
  dataTypes: readonly DataType[];
  optionsSchema: TSchema;
  /** Extra compatibility rule beyond the data type (e.g. radio buttons only for single-value enums). */
  supports?: (field: FieldDefinition) => boolean;
};

const closed = { additionalProperties: false } as const;
const Placeholder = Type.Optional(Type.String({ maxLength: 200 }));
const isMultipleEnum = (field: FieldDefinition) => field.type === 'enum' && field.settings.multiple;

const entries: EditorCatalogueEntry[] = [
  {
    id: 'textInput',
    dataTypes: ['string', 'email', 'url', 'uid'],
    optionsSchema: Type.Object({ placeholder: Placeholder }, closed),
  },
  {
    id: 'textarea',
    dataTypes: ['text', 'string'],
    optionsSchema: Type.Object(
      { placeholder: Placeholder, rows: Type.Optional(Type.Integer({ minimum: 2, maximum: 40 })) },
      closed,
    ),
  },
  {
    id: 'color',
    dataTypes: ['string'],
    optionsSchema: Type.Object(
      {
        format: Type.Optional(Type.Enum(['hex', 'rgb'])),
        presets: Type.Optional(Type.Array(Type.String({ maxLength: 32 }), { maxItems: 50 })),
      },
      closed,
    ),
  },
  {
    id: 'richText',
    dataTypes: ['richtext'],
    optionsSchema: Type.Object({ toolbar: Type.Optional(Type.Enum(['full', 'minimal'])) }, closed),
  },
  {
    id: 'numberInput',
    dataTypes: ['number', 'integer', 'decimal', 'biginteger'],
    optionsSchema: Type.Object(
      { placeholder: Placeholder, step: Type.Optional(Type.Number({ exclusiveMinimum: 0 })) },
      closed,
    ),
  },
  {
    id: 'toggle',
    dataTypes: ['boolean'],
    optionsSchema: Type.Object({}, closed),
  },
  {
    id: 'checkbox',
    dataTypes: ['boolean'],
    optionsSchema: Type.Object({}, closed),
  },
  {
    id: 'segmented',
    dataTypes: ['boolean', 'enum'],
    optionsSchema: Type.Object(
      {
        trueLabel: Type.Optional(Type.String({ maxLength: 50 })),
        falseLabel: Type.Optional(Type.String({ maxLength: 50 })),
      },
      closed,
    ),
    supports: (field) => !isMultipleEnum(field),
  },
  {
    id: 'select',
    dataTypes: ['enum'],
    optionsSchema: Type.Object({ placeholder: Placeholder }, closed),
  },
  {
    id: 'radio',
    dataTypes: ['enum'],
    optionsSchema: Type.Object({ layout: Type.Optional(Type.Enum(['vertical', 'horizontal'])) }, closed),
    supports: (field) => !isMultipleEnum(field),
  },
  {
    id: 'checkboxGroup',
    dataTypes: ['enum'],
    optionsSchema: Type.Object({ layout: Type.Optional(Type.Enum(['vertical', 'horizontal'])) }, closed),
    supports: isMultipleEnum,
  },
  {
    id: 'datePicker',
    dataTypes: ['date'],
    optionsSchema: Type.Object({}, closed),
  },
  {
    id: 'dateTimePicker',
    dataTypes: ['datetime'],
    optionsSchema: Type.Object({ display: Type.Optional(Type.Enum(['local', 'utc'])) }, closed),
  },
  {
    id: 'timePicker',
    dataTypes: ['time'],
    optionsSchema: Type.Object(
      { stepMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })) },
      closed,
    ),
  },
  {
    id: 'slugInput',
    dataTypes: ['slug'],
    optionsSchema: Type.Object({ placeholder: Placeholder }, closed),
  },
  {
    id: 'jsonEditor',
    dataTypes: ['json'],
    optionsSchema: Type.Object({ rows: Type.Optional(Type.Integer({ minimum: 3, maximum: 80 })) }, closed),
  },
  {
    id: 'mediaPicker',
    dataTypes: ['media'],
    optionsSchema: Type.Object({}, closed),
  },
  {
    id: 'relationPicker',
    dataTypes: ['relation'],
    optionsSchema: Type.Object({ allowInlineCreate: Type.Optional(Type.Boolean()) }, closed),
  },
  {
    id: 'componentEditor',
    dataTypes: ['component'],
    optionsSchema: Type.Object({ collapsed: Type.Optional(Type.Boolean()) }, closed),
  },
  {
    id: 'dynamicZoneEditor',
    dataTypes: ['dynamiczone'],
    optionsSchema: Type.Object({ collapsed: Type.Optional(Type.Boolean()) }, closed),
  },
];

export const EDITOR_CATALOGUE: ReadonlyMap<string, EditorCatalogueEntry> = new Map(
  entries.map((entry) => [entry.id, entry]),
);

/** The editor a field gets when its definition names none. */
export const DEFAULT_EDITORS: Readonly<Record<DataType, string>> = {
  string: 'textInput',
  text: 'textarea',
  richtext: 'richText',
  number: 'numberInput',
  integer: 'numberInput',
  decimal: 'numberInput',
  biginteger: 'numberInput',
  boolean: 'toggle',
  date: 'datePicker',
  datetime: 'dateTimePicker',
  time: 'timePicker',
  enum: 'select',
  json: 'jsonEditor',
  slug: 'slugInput',
  email: 'textInput',
  url: 'textInput',
  uid: 'textInput',
  media: 'mediaPicker',
  relation: 'relationPicker',
  component: 'componentEditor',
  dynamiczone: 'dynamicZoneEditor',
};

/** `vendor.name` (letters, digits, `_`, `-`), e.g. `acme.colorWheel`. Built-in IDs never contain a dot. */
export const CUSTOM_EDITOR_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)+$/;

export const isCustomEditorId = (id: string): boolean => CUSTOM_EDITOR_ID_PATTERN.test(id);

/** Built-in editors that can edit this field (for the admin's editor picker). */
export const listCompatibleEditors = (field: FieldDefinition): EditorCatalogueEntry[] =>
  entries.filter((entry) => entry.dataTypes.includes(field.type) && (entry.supports?.(field) ?? true));
