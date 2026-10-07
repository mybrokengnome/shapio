import { Type, type Static, type TSchema } from 'typebox';
import type { DataType } from './dataTypes.js';
import {
  BIGINTEGER_PATTERN,
  DATE_PATTERN,
  DATETIME_PATTERN,
  DECIMAL_PATTERN,
  TIME_PATTERN,
} from './valueFormats.js';

/**
 * Per-data-type settings: validation rules and type configuration (relation target, component reference,
 * enum values...). Each schema is closed (`additionalProperties: false`) so a typo in a hand-edited schema
 * file is reported instead of ignored. Defaults are applied by `normalizeDefinition`.
 */
const closed = { additionalProperties: false } as const;
const NonNegativeInt = Type.Integer({ minimum: 0 });
const pattern = (regex: RegExp) => Type.String({ pattern: regex.source });

const lengthRules = {
  minLength: Type.Optional(NonNegativeInt),
  maxLength: Type.Optional(Type.Integer({ minimum: 1 })),
};
const countRules = {
  min: Type.Optional(NonNegativeInt),
  max: Type.Optional(Type.Integer({ minimum: 1 })),
};

export const MEDIA_KINDS = ['image', 'video', 'audio', 'document', 'other'] as const;
export const RELATION_CARDINALITIES = ['one', 'many'] as const;

/** Languages a `code` field can hold. The language reaches the API (OpenAPI, GraphQL, generated types). */
export const CODE_LANGUAGES = ['plain', 'html', 'css', 'javascript', 'json', 'yaml', 'markdown'] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export const EnumValueSchema = Type.Object(
  {
    value: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 200 }),
  },
  closed,
);

export const SETTINGS_SCHEMAS = {
  string: Type.Object(
    { ...lengthRules, pattern: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })) },
    closed,
  ),
  text: Type.Object(lengthRules, closed),
  code: Type.Object(
    {
      language: Type.Optional(Type.Enum(CODE_LANGUAGES)),
      ...lengthRules,
      /** JSON only: a value that does not parse is refused. */
      validate: Type.Optional(Type.Boolean()),
    },
    closed,
  ),
  richtext: Type.Object(
    {
      formatVersion: Type.Optional(Type.Integer({ minimum: 1 })),
      maxLength: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    closed,
  ),
  number: Type.Object({ min: Type.Optional(Type.Number()), max: Type.Optional(Type.Number()) }, closed),
  integer: Type.Object({ min: Type.Optional(Type.Integer()), max: Type.Optional(Type.Integer()) }, closed),
  decimal: Type.Object(
    {
      precision: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      scale: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
      min: Type.Optional(pattern(DECIMAL_PATTERN)),
      max: Type.Optional(pattern(DECIMAL_PATTERN)),
    },
    closed,
  ),
  biginteger: Type.Object(
    { min: Type.Optional(pattern(BIGINTEGER_PATTERN)), max: Type.Optional(pattern(BIGINTEGER_PATTERN)) },
    closed,
  ),
  boolean: Type.Object({}, closed),
  date: Type.Object(
    { min: Type.Optional(pattern(DATE_PATTERN)), max: Type.Optional(pattern(DATE_PATTERN)) },
    closed,
  ),
  datetime: Type.Object(
    { min: Type.Optional(pattern(DATETIME_PATTERN)), max: Type.Optional(pattern(DATETIME_PATTERN)) },
    closed,
  ),
  time: Type.Object(
    { min: Type.Optional(pattern(TIME_PATTERN)), max: Type.Optional(pattern(TIME_PATTERN)) },
    closed,
  ),
  enum: Type.Object(
    {
      values: Type.Array(EnumValueSchema, { minItems: 1, maxItems: 500 }),
      multiple: Type.Optional(Type.Boolean()),
    },
    closed,
  ),
  json: Type.Object({}, closed),
  slug: Type.Object({ ...lengthRules, sourceFieldId: Type.Optional(Type.String()) }, closed),
  email: Type.Object({}, closed),
  url: Type.Object(
    { protocols: Type.Optional(Type.Array(Type.Enum(['http', 'https', 'mailto', 'tel']), { minItems: 1 })) },
    closed,
  ),
  uid: Type.Object(lengthRules, closed),
  media: Type.Object(
    {
      multiple: Type.Optional(Type.Boolean()),
      allowedKinds: Type.Optional(Type.Array(Type.Enum(MEDIA_KINDS), { minItems: 1 })),
      ...countRules,
    },
    closed,
  ),
  relation: Type.Object(
    { target: Type.String(), cardinality: Type.Enum(RELATION_CARDINALITIES), ...countRules },
    closed,
  ),
  component: Type.Object(
    { component: Type.String(), repeatable: Type.Optional(Type.Boolean()), ...countRules },
    closed,
  ),
  dynamiczone: Type.Object(
    { components: Type.Array(Type.String(), { minItems: 1, maxItems: 100 }), ...countRules },
    closed,
  ),
} satisfies Record<DataType, TSchema>;

type SettingsSchemas = typeof SETTINGS_SCHEMAS;

/** Settings as authored (defaults may be missing). */
export type DataTypeSettingsInput = { [T in DataType]: Static<SettingsSchemas[T]> };

/** Settings after normalization: the defaulted keys are always present. */
export type DataTypeSettings = Omit<
  DataTypeSettingsInput,
  'code' | 'richtext' | 'enum' | 'media' | 'component'
> & {
  code: DataTypeSettingsInput['code'] & { language: CodeLanguage };
  richtext: DataTypeSettingsInput['richtext'] & { formatVersion: number };
  enum: DataTypeSettingsInput['enum'] & { multiple: boolean };
  media: DataTypeSettingsInput['media'] & { multiple: boolean };
  component: DataTypeSettingsInput['component'] & { repeatable: boolean };
};
