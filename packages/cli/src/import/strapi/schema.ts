import { foldApiKey, type DataType, type JsonValue } from '@shapio/schema';
import { definitionApiKey, fieldApiKey, toCamelCase } from '../naming.js';
import type { PlannedDefinition, PlannedField } from '../types.js';
import type { StrapiAttribute, StrapiSchema } from './exportFiles.js';

/**
 * Strapi content types and components → planned Shapio models and components. Only the project's own content
 * types (`api::…`) are imported; plugin types (users, roles, upload files) are not. Validation rules (required,
 * lengths, ranges) are not carried over: Strapi 5 drafts may not satisfy them. Every model gets draft and
 * publish, so the import stays reviewable.
 */
export type ValueKind = 'scalar' | 'markdown' | 'blocks' | 'relation' | 'media' | 'component' | 'zone';

export type AttributePlan = {
  name: string;
  attribute: StrapiAttribute;
  type: DataType;
  valueKind: ValueKind;
};

export type DefinitionPlan = {
  schema: StrapiSchema;
  definition: PlannedDefinition;
  attributes: AttributePlan[];
  /** The attribute that titles entries (progress messages). */
  titleAttribute?: string;
};

export type SchemaPlan = { plans: Map<string, DefinitionPlan>; notes: string[] };

/** Every entry has these in Strapi; Shapio has its own. */
const SYSTEM_ATTRIBUTES = new Set([
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
]);

const SCALAR_TYPES: Readonly<Record<string, DataType>> = {
  string: 'string',
  text: 'text',
  email: 'email',
  integer: 'integer',
  biginteger: 'biginteger',
  float: 'number',
  decimal: 'decimal',
  date: 'date',
  time: 'time',
  datetime: 'datetime',
  timestamp: 'datetime',
  boolean: 'boolean',
  json: 'json',
  uid: 'uid',
};

const UNIQUE_CAPABLE = new Set<DataType>([
  'string',
  'email',
  'integer',
  'biginteger',
  'decimal',
  'date',
  'datetime',
  'time',
  'uid',
]);
const ONE_RELATIONS = new Set(['oneToOne', 'manyToOne', 'oneWay']);
const MANY_RELATIONS = new Set(['oneToMany', 'manyToMany', 'manyWay']);
const MEDIA_KINDS: Readonly<Record<string, string[]>> = {
  images: ['image'],
  videos: ['video'],
  audios: ['audio'],
  files: ['document', 'other'],
};
const GRAPHQL_NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;

/** `publishedOn` / `seo_title` → `Published on` / `Seo title`. */
const humanize = (name: string) => {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const label = words.join(' ');
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : name;
};

type Context = {
  contentTypes: ReadonlySet<string>;
  components: ReadonlySet<string>;
  notes: string[];
  owner: string;
};

type Mapped = { field: Omit<PlannedField, 'key' | 'apiKey' | 'label'>; valueKind: ValueKind } | undefined;

const skip = (context: Context, name: string, reason: string): Mapped => {
  context.notes.push(`Skipped ${context.owner}.${name}: ${reason}.`);
  return undefined;
};

const isLocalizedAttribute = (attribute: StrapiAttribute) =>
  attribute.pluginOptions?.i18n?.localized === true ||
  attribute.type === 'relation' ||
  attribute.type === 'uid';

const enumField = (name: string, attribute: StrapiAttribute, context: Context): Mapped => {
  const values = attribute.enum ?? [];
  const valid =
    values.length > 0 &&
    values.every(
      (value) => GRAPHQL_NAME.test(value) && value.length <= 64 && !['true', 'false', 'null'].includes(value),
    );
  if (!valid) {
    context.notes.push(
      `${context.owner}.${name}: enumeration values are not valid API names, imported as text.`,
    );
    return { field: { type: 'string' }, valueKind: 'scalar' };
  }
  return {
    field: { type: 'enum', settings: { values: values.map((value) => ({ value, label: humanize(value) })) } },
    valueKind: 'scalar',
  };
};

const relationField = (name: string, attribute: StrapiAttribute, context: Context): Mapped => {
  const relation = attribute.relation ?? '';
  if (attribute.mappedBy) {
    return skip(
      context,
      name,
      `the inverse side of ${attribute.target ?? 'a relation'}.${attribute.mappedBy} (the owning side is imported)`,
    );
  }
  if (!attribute.target || !context.contentTypes.has(attribute.target)) {
    return skip(context, name, `relations to ${attribute.target ?? 'polymorphic targets'} are not imported`);
  }
  if (!ONE_RELATIONS.has(relation) && !MANY_RELATIONS.has(relation)) {
    return skip(context, name, `${relation} relations are not supported`);
  }
  return {
    field: {
      type: 'relation',
      target: attribute.target,
      settings: { cardinality: MANY_RELATIONS.has(relation) ? 'many' : 'one' },
    },
    valueKind: 'relation',
  };
};

const mediaField = (attribute: StrapiAttribute): Mapped => {
  const kinds = [...new Set((attribute.allowedTypes ?? []).flatMap((type) => MEDIA_KINDS[type] ?? []))];
  const settings: Record<string, JsonValue> = { multiple: attribute.multiple === true };
  if (kinds.length > 0) {
    settings.allowedKinds = kinds;
  }
  return { field: { type: 'media', settings }, valueKind: 'media' };
};

const structuredField = (name: string, attribute: StrapiAttribute, context: Context): Mapped => {
  if (attribute.type === 'component') {
    if (!attribute.component || !context.components.has(attribute.component)) {
      return skip(context, name, `unknown component ${attribute.component ?? ''}`);
    }
    return {
      field: {
        type: 'component',
        component: attribute.component,
        settings: { repeatable: attribute.repeatable === true },
      },
      valueKind: 'component',
    };
  }
  const components = (attribute.components ?? []).filter((uid) => context.components.has(uid));
  if (components.length === 0) {
    return skip(context, name, 'a dynamic zone without known components');
  }
  return { field: { type: 'dynamiczone', components }, valueKind: 'zone' };
};

const mapAttribute = (name: string, attribute: StrapiAttribute, context: Context): Mapped => {
  const scalarType = SCALAR_TYPES[attribute.type];
  if (scalarType) {
    const unique = (attribute.unique === true || attribute.type === 'uid') && UNIQUE_CAPABLE.has(scalarType);
    return { field: { type: scalarType, ...(unique ? { unique: true } : {}) }, valueKind: 'scalar' };
  }
  switch (attribute.type) {
    case 'richtext':
      return { field: { type: 'richtext' }, valueKind: 'markdown' };
    case 'blocks':
      return { field: { type: 'richtext' }, valueKind: 'blocks' };
    case 'enumeration':
      return enumField(name, attribute, context);
    case 'relation':
      return relationField(name, attribute, context);
    case 'media':
      return mediaField(attribute);
    case 'component':
    case 'dynamiczone':
      return structuredField(name, attribute, context);
    case 'password':
      return skip(context, name, 'passwords are never imported');
    default:
      return skip(context, name, `the "${attribute.type}" type is not supported`);
  }
};

const planDefinition = (schema: StrapiSchema, apiKey: string, context: Context): DefinitionPlan => {
  const isComponent = schema.modelType === 'component';
  const localized = !isComponent && schema.pluginOptions?.i18n?.localized === true;
  const takenFields = new Set<string>();
  const attributes: AttributePlan[] = [];
  const fields: PlannedField[] = [];
  for (const [name, attribute] of Object.entries(schema.attributes)) {
    if (SYSTEM_ATTRIBUTES.has(name)) {
      continue;
    }
    const mapped = mapAttribute(name, attribute, { ...context, owner: apiKey });
    if (!mapped) {
      continue;
    }
    attributes.push({ name, attribute, type: mapped.field.type, valueKind: mapped.valueKind });
    const fieldKey = fieldApiKey(name, takenFields);
    if (fieldKey !== name) {
      context.notes.push(
        `${apiKey}.${name} is named ${fieldKey} (the name is reserved or not a valid API ID).`,
      );
    }
    fields.push({
      key: name,
      apiKey: fieldKey,
      label: humanize(name),
      ...mapped.field,
      ...(localized ? { localized: isLocalizedAttribute(attribute) } : {}),
    });
  }
  const titleAttribute = attributes.find((attribute) => attribute.type === 'string')?.name;
  const definition: PlannedDefinition = {
    key: schema.uid,
    kind: isComponent ? 'component' : schema.kind === 'singleType' ? 'singleton' : 'collection',
    apiKey,
    label: schema.info?.displayName ?? humanize(apiKey),
    ...(schema.info?.description ? { description: schema.info.description.slice(0, 2000) } : {}),
    ...(localized ? { localized: true } : {}),
    ...(isComponent ? { category: schema.category ?? schema.uid.split('.')[0] ?? 'imported' } : {}),
    ...(titleAttribute ? { titleField: titleAttribute } : {}),
    fields,
  };
  const plural = schema.info?.pluralName ? toCamelCase(schema.info.pluralName) : undefined;
  if (definition.kind === 'collection' && plural && foldApiKey(plural) !== foldApiKey(apiKey)) {
    definition.pluralApiKey = plural;
  }
  return { schema, definition, attributes, ...(titleAttribute ? { titleAttribute } : {}) };
};

/** A component's API ID: its name (`shared.seo` → `seo`), or category and name when names repeat. */
const componentBaseNames = (components: readonly StrapiSchema[]) => {
  const counts = new Map<string, number>();
  const nameOf = (uid: string) => uid.split('.').slice(1).join('.') || uid;
  components.forEach((schema) => counts.set(nameOf(schema.uid), (counts.get(nameOf(schema.uid)) ?? 0) + 1));
  return (schema: StrapiSchema) =>
    (counts.get(nameOf(schema.uid)) ?? 0) > 1 ? schema.uid : nameOf(schema.uid);
};

export const planStrapiSchema = (schemas: readonly StrapiSchema[]): SchemaPlan => {
  const contentTypes = schemas.filter(
    (schema) => schema.modelType === 'contentType' && schema.uid.startsWith('api::'),
  );
  const components = schemas.filter((schema) => schema.modelType === 'component');
  const context: Context = {
    contentTypes: new Set(contentTypes.map((schema) => schema.uid)),
    components: new Set(components.map((schema) => schema.uid)),
    notes: [],
    owner: '',
  };
  const taken = new Set<string>();
  const plans = new Map<string, DefinitionPlan>();
  /** The API ID for `name`; a reserved or repeated name gets a suffix, which the plan lists. */
  const claimApiKey = (schema: StrapiSchema, name: string) => {
    const apiKey = definitionApiKey(name, taken);
    if (apiKey !== toCamelCase(name)) {
      context.notes.push(`${schema.uid} is named ${apiKey} (the name is reserved or already taken).`);
    }
    return apiKey;
  };
  for (const schema of contentTypes) {
    const name = schema.info?.singularName ?? schema.uid.split('.').at(-1) ?? 'model';
    plans.set(schema.uid, planDefinition(schema, claimApiKey(schema, name), context));
  }
  const baseName = componentBaseNames(components);
  for (const schema of components) {
    plans.set(schema.uid, planDefinition(schema, claimApiKey(schema, baseName(schema)), context));
  }
  if (contentTypes.some((schema) => schema.options?.draftAndPublish === false)) {
    context.notes.push(
      `Draft and publish is turned on for ${contentTypes
        .filter((schema) => schema.options?.draftAndPublish === false)
        .map((schema) => plans.get(schema.uid)?.definition.apiKey)
        .join(', ')} (off in Strapi), so imported entries are reviewed before they go live.`,
    );
  }
  return { plans, notes: context.notes };
};
