/** Every stored data type. A field's data type is separate from the editor that renders it (brief §2.5). */
export const DATA_TYPES = [
  'string',
  'text',
  'code',
  'richtext',
  'number',
  'integer',
  'decimal',
  'biginteger',
  'boolean',
  'date',
  'datetime',
  'time',
  'enum',
  'json',
  'slug',
  'email',
  'url',
  'uid',
  'media',
  'relation',
  'component',
  'dynamiczone',
] as const;

export type DataType = (typeof DATA_TYPES)[number];

export const isDataType = (value: unknown): value is DataType =>
  typeof value === 'string' && (DATA_TYPES as readonly string[]).includes(value);

/**
 * Scalar types stored as one JSON value per field (string, number or boolean). Only these can be unique,
 * filterable or sortable: their index expression is a single cast of `data ->> fieldId` (ADR 0001).
 */
export const SCALAR_DATA_TYPES: ReadonlySet<DataType> = new Set<DataType>([
  'string',
  'text',
  'number',
  'integer',
  'decimal',
  'biginteger',
  'boolean',
  'date',
  'datetime',
  'time',
  'enum',
  'slug',
  'email',
  'url',
  'uid',
]);

/** Types that may carry `unique: true` (boolean and long text make no sense as unique keys). */
export const UNIQUE_CAPABLE_DATA_TYPES: ReadonlySet<DataType> = new Set<DataType>([
  'string',
  'number',
  'integer',
  'decimal',
  'biginteger',
  'date',
  'datetime',
  'time',
  'slug',
  'email',
  'url',
  'uid',
]);

/** Types whose values point at other definitions; the reference checks look at these. */
export const REFERENCE_DATA_TYPES: ReadonlySet<DataType> = new Set<DataType>([
  'relation',
  'component',
  'dynamiczone',
]);

/**
 * How a value is physically represented in the content JSON. Changing a field's type within a storage
 * family never needs a data conversion, only a validity check; across families it is a conversion.
 */
export type StorageFamily =
  | 'jsonString'
  | 'jsonNumber'
  | 'numericString'
  | 'boolean'
  | 'json'
  | 'richtext'
  | 'media'
  | 'relation'
  | 'component'
  | 'dynamiczone';

export const STORAGE_FAMILY: Readonly<Record<DataType, StorageFamily>> = {
  string: 'jsonString',
  text: 'jsonString',
  code: 'jsonString',
  slug: 'jsonString',
  email: 'jsonString',
  url: 'jsonString',
  uid: 'jsonString',
  enum: 'jsonString',
  date: 'jsonString',
  datetime: 'jsonString',
  time: 'jsonString',
  number: 'jsonNumber',
  integer: 'jsonNumber',
  decimal: 'numericString',
  biginteger: 'numericString',
  boolean: 'boolean',
  json: 'json',
  richtext: 'richtext',
  media: 'media',
  relation: 'relation',
  component: 'component',
  dynamiczone: 'dynamiczone',
};
