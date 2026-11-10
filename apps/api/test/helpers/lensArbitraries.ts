import {
  compileLens,
  createDefinitionIndex,
  DATA_TYPES,
  normalizeDefinition,
  plainTextToRichText,
  SCALAR_DATA_TYPES,
  UNIQUE_CAPABLE_DATA_TYPES,
  validateSchema,
  type DataType,
  type DefinitionLens,
  type FieldDefinition,
  type LocaleDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import fc from 'fast-check';
import { proposeEntry, isTransformStep } from '../../src/content/migration/propose.js';
import { resolveModelById, type ContentModel } from '../../src/content/model.js';
import { buildValidator, COMPONENT_KEY } from '../../src/content/validator/index.js';
import type { ContentData } from '../../src/db/contentData.js';
import type { ScannedHead } from '../../src/repositories/entryHeads.js';
import { buildChangePlan } from '../../src/schema/planner/plan.js';
import { buildSnapshot, type SchemaSnapshot } from '../../src/schema/snapshot.js';

/**
 * fast-check generators for schema-lens property tests: a small schema (one localized collection `M` with 1–8
 * fields over every data type, two relation targets, 0–3 components that may embed each other), change
 * sequences drawn from every change kind the differ knows, stored data valid for a schema (checked and
 * canonicalized by the repo's own content validator), and data migration through the real planner
 * (`buildChangePlan`) and conversion (`proposeEntry` → `convertValue`). Every schema a generator yields
 * passes `validateSchema`; a change the planner or the activation checks would refuse is not applied.
 */

/** Deterministic UUIDs: uuid(1) = 00000000-0000-4000-8000-000000000001. */
export const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const MODEL_ID = uuid(1);
export const TARGET_IDS = [uuid(2), uuid(3)] as const;
export const COMPONENT_IDS = [uuid(10), uuid(11), uuid(12)] as const;
/** Field IDs start here; changes allocate fresh ones above `FRESH_FIELD_BASE`. */
const FIELD_BASE = 0x100;
const FRESH_FIELD_BASE = 0x10000;

export const LOCALES: LocaleDefinition[] = [
  { code: 'en', label: 'English', isDefault: true, fallbacks: [] },
  { code: 'fr', label: 'French', isDefault: false, fallbacks: ['en'] },
];

export const ENUM_POOL = ['a', 'b', 'c', 'd', 'e'] as const;
const API_KEY_POOL = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'zeta',
  'eta',
  'theta',
  'iota',
  'kappa',
  'lambda',
  'mu',
] as const;

/** A schema: the model under test, its relation targets, and its components (by position = COMPONENT_IDS). */
export type Schema = {
  model: SchemaDefinition;
  targets: SchemaDefinition[];
  components: SchemaDefinition[];
};

export const definitionsOf = (schema: Schema): SchemaDefinition[] => [
  schema.model,
  ...schema.targets,
  ...schema.components,
];

// ---------------------------------------------------------------------------------------------------------
// Fields

type RawField = Record<string, unknown> & { apiKey: string; type: DataType; label: string };

/** What a field of `type` may hold, given the components it may embed. */
const settingsArb = (
  type: DataType,
  embeddable: readonly string[],
  relationTargets: readonly string[],
): fc.Arbitrary<Record<string, unknown> | null> => {
  switch (type) {
    case 'enum':
      return fc
        .record({
          values: fc.subarray([...ENUM_POOL], { minLength: 1 }),
          multiple: fc.boolean(),
        })
        .map(({ values, multiple }) => ({
          values: values.map((value) => ({ value, label: value.toUpperCase() })),
          multiple,
        }));
    case 'media':
      return fc.record({ multiple: fc.boolean() });
    case 'relation':
      return fc.record({
        target: fc.constantFrom(...relationTargets),
        cardinality: fc.constantFrom('one', 'many'),
      });
    case 'component':
      return embeddable.length === 0
        ? fc.constant(null)
        : fc.record({ component: fc.constantFrom(...embeddable), repeatable: fc.boolean() });
    case 'dynamiczone':
      return embeddable.length === 0
        ? fc.constant(null)
        : fc.subarray([...embeddable], { minLength: 1 }).map((components) => ({ components }));
    case 'code':
      return fc.constantFrom('plain', 'json', 'html').map((language) => ({ language }));
    case 'richtext':
      // Format version 1 is the only one documents exist in; 2 is a schema-only value (no converter).
      return fc.constant({});
    default:
      return fc.constant({});
  }
};

type FieldContext = {
  /** Components this definition may embed (no cycles). */
  embeddable: readonly string[];
  isComponent: boolean;
};

const flagsArb = (type: DataType, context: FieldContext) =>
  fc.record({
    // Never required at creation (data may leave any field empty); the `flag` change turns it on.
    required: fc.constant(false),
    localized: context.isComponent ? fc.constant(false) : fc.boolean(),
    public: fc.oneof(
      { weight: 4, arbitrary: fc.constant(true) },
      { weight: 1, arbitrary: fc.constant(false) },
    ),
    unique:
      !context.isComponent && UNIQUE_CAPABLE_DATA_TYPES.has(type)
        ? fc.oneof({ weight: 5, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) })
        : fc.constant(false),
    filterable: !context.isComponent && SCALAR_DATA_TYPES.has(type) ? fc.boolean() : fc.constant(false),
    sortable: !context.isComponent && SCALAR_DATA_TYPES.has(type) ? fc.boolean() : fc.constant(false),
    deprecated: fc.oneof(
      { weight: 9, arbitrary: fc.constant(false) },
      { weight: 1, arbitrary: fc.constant(true) },
    ),
  });

/** A field of a given type (no ID, no API ID), or null when the type cannot be used here. */
export const fieldOfTypeArb = (
  type: DataType,
  context: FieldContext,
  relationTargets: readonly string[],
): fc.Arbitrary<Omit<RawField, 'apiKey'> | null> =>
  fc
    .tuple(settingsArb(type, context.embeddable, relationTargets), flagsArb(type, context))
    .map(([settings, flags]) =>
      settings === null ? null : { type, label: `L ${type}`, settings, ...flags },
    );

const fieldTypeArb = fc.constantFrom(...DATA_TYPES);

/** A valid default per type (required fields are backfilled from it); undefined: none is generated. */
const DEFAULTS: Partial<Record<DataType, unknown>> = {
  string: 'dflt',
  text: 'dflt',
  code: 'x',
  number: 1.5,
  integer: 1,
  decimal: '1.5',
  biginteger: '7',
  boolean: true,
  date: '2024-01-01',
  datetime: '2024-01-01T00:00:00.000Z',
  time: '10:00',
  json: { d: 1 },
  slug: 'dflt',
  email: 'd@x.co',
  url: 'https://d.x',
  uid: 'dflt',
};

/** A field's default value, when one can be given: enums default to their first value. */
export const defaultFor = (field: Record<string, unknown>): unknown => {
  if (field.type === 'enum') {
    const settings = field.settings as { values: Array<{ value: string }>; multiple?: boolean };
    const first = settings.values[0]?.value;
    return first === undefined ? undefined : settings.multiple ? [first] : first;
  }
  return DEFAULTS[field.type as DataType];
};

const fieldsArb = (context: FieldContext, relationTargets: readonly string[], min: number, max: number) =>
  fc
    .array(
      fieldTypeArb.chain((type) => fieldOfTypeArb(type, context, relationTargets)),
      { minLength: min, maxLength: max },
    )
    .map((fields) => fields.filter((field): field is Omit<RawField, 'apiKey'> => field !== null))
    .filter((fields) => fields.length >= min);

// ---------------------------------------------------------------------------------------------------------
// Definitions

const withIds = (fields: ReadonlyArray<Omit<RawField, 'apiKey'>>, firstId: number) =>
  fields.map((field, index) => ({
    ...field,
    id: uuid(firstId + index),
    apiKey: API_KEY_POOL[index] as string,
  }));

const normalize = (input: Record<string, unknown>): SchemaDefinition =>
  normalizeDefinition(input as Parameters<typeof normalizeDefinition>[0]);

const target = (index: number): SchemaDefinition =>
  normalize({
    id: TARGET_IDS[index],
    kind: 'collection',
    apiKey: `target${index}`,
    pluralApiKey: `targets${index}`,
    label: `Target ${index}`,
    localized: true,
    fields: [{ id: uuid(0x50 + index), apiKey: 'name', label: 'Name', type: 'string' }],
  });

const RELATION_TARGETS = [MODEL_ID, ...TARGET_IDS];

/** Whether a schema is one the server would accept. */
export const isValidSchema = (schema: Schema): boolean => validateSchema(definitionsOf(schema)).length === 0;

/** A schema: 0–3 components (component k may embed components above it), then the model. */
export const schemaArb: fc.Arbitrary<Schema> = fc
  .integer({ min: 0, max: 3 })
  .chain((componentCount) => {
    const componentIds = COMPONENT_IDS.slice(0, componentCount);
    const components = componentIds.map((componentId, index) =>
      fieldsArb({ embeddable: componentIds.slice(index + 1), isComponent: true }, RELATION_TARGETS, 1, 4).map(
        (fields) =>
          normalize({
            id: componentId,
            kind: 'component',
            apiKey: `comp${index}`,
            label: `Comp ${index}`,
            fields: withIds(fields, FIELD_BASE + 0x40 * (index + 1)),
          }),
      ),
    );
    const model = fieldsArb({ embeddable: componentIds, isComponent: false }, RELATION_TARGETS, 1, 8).map(
      (fields) =>
        normalize({
          id: MODEL_ID,
          kind: 'collection',
          apiKey: 'page',
          pluralApiKey: 'pages',
          label: 'Page',
          localized: true,
          fields: withIds(fields, FIELD_BASE),
        }),
    );
    return fc.tuple(model, fc.tuple(...components));
  })
  .map(([model, components]) => ({ model, targets: [target(0), target(1)], components }))
  .filter(isValidSchema);

// ---------------------------------------------------------------------------------------------------------
// Snapshots, validators and lenses

const revisionIds = new WeakMap<SchemaDefinition, string>();
let revisionCounter = 0;
/** One revision ID per definition object: a changed definition is a new object, so a new revision. */
const revisionOf = (definition: SchemaDefinition) => {
  let revision = revisionIds.get(definition);
  if (!revision) {
    revisionCounter += 1;
    revision = `ffffffff-0000-4000-8000-${revisionCounter.toString(16).padStart(12, '0')}`;
    revisionIds.set(definition, revision);
  }
  return revision;
};

const snapshots = new WeakMap<Schema, SchemaSnapshot>();
export const snapshotOf = (schema: Schema, version = 1): SchemaSnapshot => {
  let snapshot = snapshots.get(schema);
  if (!snapshot) {
    snapshot = buildSnapshot(
      version,
      definitionsOf(schema).map((definition) => ({
        definition,
        siteId: null,
        version: 1,
        revisionId: revisionOf(definition),
        hash: revisionOf(definition),
        activatedAt: new Date(0),
      })),
      LOCALES,
    );
    snapshots.set(schema, snapshot);
  }
  return snapshot;
};

export const contentModelOf = (schema: Schema): ContentModel =>
  resolveModelById(snapshotOf(schema), MODEL_ID) as ContentModel;

export const validatorOf = (schema: Schema) => buildValidator(snapshotOf(schema), contentModelOf(schema));

const sideOf = (schema: Schema) => createDefinitionIndex(definitionsOf(schema));

/** The lens reading `stored` (today) as `client` sees it, for the model or one of its components. */
export const lensBetween = (stored: Schema, client: Schema, definitionId = MODEL_ID): DefinitionLens =>
  compileLens(sideOf(stored), sideOf(client), definitionId) as DefinitionLens;

// ---------------------------------------------------------------------------------------------------------
// Data

const UUIDS = Array.from({ length: 6 }, (_, index) => uuid(0xa000 + index));

/** Text that also looks like numbers, booleans, dates and enum values, so conversions get exercised. */
const textArb = fc.oneof(
  fc.constantFrom('12', ' 7 ', '4.5', '-3', '1e3', '0', 'true', 'abc', 'Hello world', 'a', 'b', 'c'),
  fc.constantFrom('2024-02-29', '2024-01-01T10:00:00.000Z', '10:30', '10:30:00', 'x@y.co', 'https://e.x/a'),
  fc.constantFrom('99999999999999999999', '0.1', '-0', 'NaN', 'Infinity', '00012', 'summer-sale'),
  // Adversarial numeric text: huge exponents (that parse to 0 or overflow), long digit runs, signs, padding.
  fc.constantFrom(
    '1e-400000000',
    '0e400000000',
    ' -0E-400000000 ',
    '1e400',
    '1e-400',
    '+007.50e+2',
    '0x10',
    ' 1e3 ',
  ),
  fc
    .tuple(
      fc.constantFrom('', '-', '+', ' '),
      fc.nat({ max: 200 }),
      fc.constantFrom('', 'e', 'E-', 'e+'),
      fc.nat(),
    )
    .map(
      ([sign, length, marker, exponent]) =>
        `${sign}${'9'.repeat(length + 1)}${marker === '' ? '' : `${marker}${exponent}`}`,
    ),
  fc.string({ unit: 'grapheme-ascii', maxLength: 12 }),
);

const valueArb = (field: FieldDefinition, schema: Schema, depth: number): fc.Arbitrary<unknown> => {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'code':
      return textArb;
    case 'richtext':
      return textArb.map((text) => plainTextToRichText(text));
    case 'number':
      return fc.oneof(
        fc.integer({ min: -1000, max: 1000 }),
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom(0.1, 1e-7, 1e21, 4.5, -0),
      );
    case 'integer':
      return fc.oneof(fc.integer({ min: -1000, max: 1000 }), fc.constantFrom(2 ** 53 - 1, 1e21));
    case 'decimal':
      return fc.constantFrom('12.5', '-3', '0.001', '100', '99999999999999999999.5', '0');
    case 'biginteger':
      return fc.constantFrom('123', '-7', '0', '123456789012345678901', '9007199254740993');
    case 'boolean':
      return fc.boolean();
    case 'date':
      return fc.constantFrom('2024-02-29', '1999-12-31', '2026-11-10');
    case 'datetime':
      return fc.constantFrom('2024-01-01T10:00:00.000Z', '2026-11-10T14:02:19.880Z');
    case 'time':
      return fc.constantFrom('10:30', '23:59:59', '00:00:00.000');
    case 'enum': {
      const values = field.settings.values.map((entry) => entry.value);
      return field.settings.multiple ? fc.subarray(values, { minLength: 1 }) : fc.constantFrom(...values);
    }
    case 'json':
      return fc.jsonValue({ maxDepth: 2 });
    case 'slug':
      return fc.constantFrom('summer-sale', 'a', 'x-1');
    case 'email':
      return fc.constantFrom('x@y.co', 'ADA@example.com');
    case 'url':
      return fc.constantFrom('https://e.x/a', 'http://shapio.dev');
    case 'uid':
      return fc.constantFrom('abc', 'A_b.c~1');
    case 'media':
      return field.settings.multiple
        ? fc.subarray(UUIDS, { minLength: 1, maxLength: 3 })
        : fc.constantFrom(...UUIDS);
    case 'relation':
      return field.settings.cardinality === 'many'
        ? fc.subarray(UUIDS, { minLength: 1, maxLength: 3 })
        : fc.constantFrom(...UUIDS);
    case 'component': {
      const component = schema.components.find((candidate) => candidate.id === field.settings.component);
      if (!component || depth > 4) {
        return fc.constant(undefined);
      }
      const instance = instanceArb(component, schema, depth + 1);
      return field.settings.repeatable ? fc.array(instance, { maxLength: 3 }) : instance;
    }
    case 'dynamiczone': {
      const allowed = schema.components.filter((candidate) =>
        field.settings.components.includes(candidate.id),
      );
      if (allowed.length === 0 || depth > 4) {
        return fc.constant(undefined);
      }
      return fc.array(
        fc.constantFrom(...allowed).chain((component) =>
          instanceArb(component, schema, depth + 1).map((item) => ({
            ...item,
            [COMPONENT_KEY]: component.id,
          })),
        ),
        { maxLength: 3 },
      );
    }
  }
};

/** Present, null or absent per field. */
const fieldsDataArb = (
  definition: SchemaDefinition,
  schema: Schema,
  depth: number,
): fc.Arbitrary<Record<string, unknown>> =>
  fc
    .tuple(
      ...definition.fields.map((field) =>
        fc.option(fc.option(valueArb(field, schema, depth), { nil: null, freq: 8 }), {
          nil: undefined,
          freq: 4,
        }),
      ),
    )
    .map((values) => {
      const data: Record<string, unknown> = {};
      definition.fields.forEach((field, index) => {
        if (values[index] !== undefined) {
          data[field.id] = values[index];
        }
      });
      return data;
    });

function instanceArb(component: SchemaDefinition, schema: Schema, depth: number) {
  return fieldsDataArb(component, schema, depth);
}

/**
 * Valid stored data for the schema's model: raw values cleaned by the repo's validator (fields with issues
 * are dropped one at a time until none remain) and canonicalized (`validate().data`), as a write stores it.
 */
const liveSchemas = new WeakMap<Schema, Schema>();
/**
 * The schema with no field deprecated: a deprecated field's stored values were written (and validated) while
 * it was live, and no write reaches it since (`fromInput` refuses it), so data is generated as if it were live.
 */
const liveSchemaOf = (schema: Schema): Schema => {
  let live = liveSchemas.get(schema);
  if (!live) {
    const undeprecate = (definition: SchemaDefinition) =>
      definition.fields.some((field) => field.deprecated)
        ? normalize({
            ...definition,
            fields: definition.fields.map((field) => ({ ...field, deprecated: false })),
          })
        : definition;
    live = {
      model: undeprecate(schema.model),
      targets: schema.targets,
      components: schema.components.map(undeprecate),
    };
    liveSchemas.set(schema, live);
  }
  return live;
};

export const canonicalData = (schema: Schema, raw: Readonly<ContentData>): ContentData => {
  const validator = validatorOf(liveSchemaOf(schema));
  let data: ContentData = { ...raw };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const outcome = validator.validate(data, { skipRequired: true });
    if (outcome.issues.length === 0) {
      return outcome.data;
    }
    const failing = new Set(outcome.issues.map((issue) => issue.path.split('/')[1]));
    data = Object.fromEntries(
      Object.entries(data).filter(([fieldId]) => {
        const apiKey = schema.model.fields.find((field) => field.id === fieldId)?.apiKey;
        return apiKey === undefined || !failing.has(apiKey);
      }),
    );
  }
  return {};
};

export const dataArb = (schema: Schema): fc.Arbitrary<ContentData> =>
  fieldsDataArb(schema.model, schema, 0).map((raw) => canonicalData(schema, raw as ContentData));

/** Whether data passes the schema's validator (required not enforced, as activation's checks). */
export const isValidData = (schema: Schema, data: Readonly<ContentData>): boolean =>
  validatorOf(schema).validate(data, { skipRequired: true }).issues.length === 0;

// ---------------------------------------------------------------------------------------------------------
// Changes

export const CHANGE_OPS = [
  'renameField',
  'renameDefinition',
  'reorder',
  'label',
  'addField',
  'removeField',
  'removeReadd',
  'retype',
  'enumValues',
  'flipMultiple',
  'flipCardinality',
  'retarget',
  'swapComponent',
  'flipRepeatable',
  'zoneAllowed',
  'formatVersion',
  'flag',
  'modelLocalized',
  'drafts',
] as const;
export type ChangeOp = (typeof CHANGE_OPS)[number];

/** Ops that only rename, reorder, relabel or add (property: rename transparency). */
export const TRANSPARENT_OPS: readonly ChangeOp[] = [
  'renameField',
  'renameDefinition',
  'reorder',
  'label',
  'addField',
];

export const FLAGS = [
  'required',
  'unique',
  'public',
  'deprecated',
  'localized',
  'filterable',
  'sortable',
] as const;

/** An abstract change: picks are taken modulo what exists when it is applied, so it shrinks well. */
export type Change = {
  op: ChangeOp;
  /** 0: the model; 1–3: a component (modulo the components there are). */
  definition: number;
  field: number;
  /** A new field's type, or a retype's. */
  type: DataType;
  /** A seed for everything else (new API ID, permutation, enum subset, flag, …). */
  seed: number;
  /** The new field (addField, removeReadd, retype) as generated for `type`; settings resolved at apply time. */
  fresh: Omit<RawField, 'apiKey'> | null;
};

const changeArbOf = (ops: readonly ChangeOp[]): fc.Arbitrary<Change> =>
  fc
    .record({
      op: fc.constantFrom(...ops),
      definition: fc.oneof(
        { weight: 3, arbitrary: fc.constant(0) },
        { weight: 1, arbitrary: fc.integer({ min: 1, max: 3 }) },
      ),
      field: fc.nat({ max: 15 }),
      type: fieldTypeArb,
      seed: fc.nat({ max: 1_000_000 }),
    })
    .chain((change) =>
      fieldOfTypeArb(
        change.type,
        { embeddable: COMPONENT_IDS, isComponent: change.definition > 0 },
        RELATION_TARGETS,
      ).map((fresh) => {
        // A third of new fields are required with a default: the activation backfills existing entries.
        const value = fresh ? defaultFor(fresh) : undefined;
        return {
          ...change,
          fresh:
            fresh && value !== undefined && change.seed % 3 === 0
              ? { ...fresh, required: true, defaultValue: value }
              : fresh,
        };
      }),
    );

export const changeArb = changeArbOf(CHANGE_OPS);
export const transparentChangeArb = changeArbOf(TRANSPARENT_OPS);

type Editable = { definition: SchemaDefinition; replace: (next: SchemaDefinition) => Schema };

const editableOf = (schema: Schema, pick: number): Editable | null => {
  if (pick === 0 || schema.components.length === 0) {
    return { definition: schema.model, replace: (next) => ({ ...schema, model: next }) };
  }
  const index = (pick - 1) % schema.components.length;
  return {
    definition: schema.components[index] as SchemaDefinition,
    replace: (next) => ({
      ...schema,
      components: schema.components.map((component, position) => (position === index ? next : component)),
    }),
  };
};

const pickFrom = <T>(items: readonly T[], seed: number): T | undefined =>
  items.length === 0 ? undefined : items[seed % items.length];

/** Components a definition may embed without a cycle: those with a higher position, for a component. */
const embeddableFor = (schema: Schema, definition: SchemaDefinition): string[] => {
  const ids = schema.components.map((component) => component.id);
  if (definition.kind !== 'component') {
    return ids;
  }
  return ids.slice(ids.indexOf(definition.id) + 1);
};

/** Settings for `fresh` resolved against what this definition may hold now. */
const resolveFresh = (
  schema: Schema,
  definition: SchemaDefinition,
  fresh: Omit<RawField, 'apiKey'>,
  seed: number,
): Omit<RawField, 'apiKey'> | null => {
  const embeddable = embeddableFor(schema, definition);
  const settings = { ...(fresh.settings as Record<string, unknown>) };
  if (fresh.type === 'component') {
    const component = pickFrom(embeddable, seed);
    if (!component) {
      return null;
    }
    settings.component = component;
  }
  if (fresh.type === 'dynamiczone') {
    const allowed = embeddable.filter(
      (_, index) => ((seed >> index) & 1) === 1 || index === seed % Math.max(1, embeddable.length),
    );
    if (allowed.length === 0) {
      return null;
    }
    settings.components = allowed;
  }
  return {
    ...fresh,
    settings,
    ...(definition.kind === 'component'
      ? { localized: false, unique: false, filterable: false, sortable: false }
      : {}),
  };
};

const withFields = (definition: SchemaDefinition, fields: readonly unknown[]): SchemaDefinition =>
  normalize({ ...definition, fields });

const freshApiKey = (definition: SchemaDefinition, seed: number): string => {
  const used = new Set(definition.fields.map((field) => field.apiKey.toLowerCase()));
  const free = API_KEY_POOL.filter((key) => !used.has(key));
  return pickFrom(free, seed) ?? `f${seed}`;
};

let freshCounter = 0;
/** A field ID no generated schema has used. */
const freshFieldId = () => {
  freshCounter += 1;
  return uuid(FRESH_FIELD_BASE + freshCounter);
};

const toggleSetting = (field: FieldDefinition, settings: Record<string, unknown>) => ({
  ...field,
  settings,
});

/** Applies one change; null when it does not apply to this schema (nothing to change, or it is invalid). */
/** Ops that need a field of one of these types; the definition is picked among those that have one. */
const TYPED_OPS: Partial<Record<ChangeOp, readonly DataType[]>> = {
  enumValues: ['enum'],
  flipMultiple: ['enum', 'media'],
  flipCardinality: ['relation'],
  flipRepeatable: ['component'],
  retarget: ['relation'],
  swapComponent: ['component'],
  zoneAllowed: ['dynamiczone'],
  formatVersion: ['richtext'],
};

const typedEditable = (schema: Schema, change: Change): Editable | null => {
  const types = TYPED_OPS[change.op];
  if (!types) {
    return editableOf(schema, change.definition);
  }
  const holders = [0, ...schema.components.map((_, index) => index + 1)].filter((pick) =>
    editableOf(schema, pick)?.definition.fields.some((field) => types.includes(field.type)),
  );
  const pick = pickFrom(holders, change.definition);
  return pick === undefined ? null : editableOf(schema, pick);
};

export const applyChange = (schema: Schema, change: Change): Schema | null => {
  const editable = typedEditable(schema, change);
  if (!editable) {
    return null;
  }
  const { definition, replace } = editable;
  const fields = definition.fields;
  const index = fields.length === 0 ? -1 : change.field % fields.length;
  const field = index === -1 ? undefined : fields[index];
  const replaceField = (next: unknown) =>
    replace(
      withFields(
        definition,
        fields.map((candidate, position) => (position === index ? next : candidate)),
      ),
    );
  const { seed } = change;
  let next: Schema | null = null;
  switch (change.op) {
    case 'renameField':
      next = field ? replaceField({ ...field, apiKey: freshApiKey(definition, seed) }) : null;
      break;
    case 'renameDefinition': {
      const suffix = `v${seed % 97}`;
      next = replace(
        normalize({
          ...definition,
          apiKey: `${definition.kind === 'component' ? 'comp' : 'page'}${suffix}`,
          ...(definition.kind === 'collection' ? { pluralApiKey: `pages${suffix}` } : {}),
        }),
      );
      break;
    }
    case 'reorder': {
      if (fields.length < 2) {
        return null;
      }
      const rotated = [...fields.slice(seed % fields.length), ...fields.slice(0, seed % fields.length)];
      next = replace(withFields(definition, seed % 2 === 0 ? rotated.reverse() : rotated));
      break;
    }
    case 'label':
      next = field ? replaceField({ ...field, label: `Relabeled ${seed}`, description: `d${seed}` }) : null;
      break;
    case 'addField': {
      const fresh = change.fresh && resolveFresh(schema, definition, change.fresh, seed);
      next = fresh
        ? replace(
            withFields(definition, [
              ...fields,
              { ...fresh, id: freshFieldId(), apiKey: freshApiKey(definition, seed) },
            ]),
          )
        : null;
      break;
    }
    case 'removeField':
      next =
        field && fields.length > 1
          ? replace(
              withFields(
                definition,
                fields.filter((_, position) => position !== index),
              ),
            )
          : null;
      break;
    case 'removeReadd': {
      const fresh = change.fresh && resolveFresh(schema, definition, change.fresh, seed);
      next = field && fresh ? replaceField({ ...fresh, id: freshFieldId(), apiKey: field.apiKey }) : null;
      break;
    }
    case 'retype': {
      const fresh = change.fresh && resolveFresh(schema, definition, change.fresh, seed);
      if (!field || !fresh || fresh.type === field.type) {
        return null;
      }
      const { editor: _editor, ...rest } = field;
      next = replaceField({
        ...rest,
        type: fresh.type,
        settings: fresh.settings,
        unique: rest.unique && UNIQUE_CAPABLE_DATA_TYPES.has(fresh.type as DataType),
        filterable: rest.filterable && SCALAR_DATA_TYPES.has(fresh.type as DataType),
        sortable: rest.sortable && SCALAR_DATA_TYPES.has(fresh.type as DataType),
      });
      break;
    }
    case 'enumValues': {
      const enums = fields.filter((candidate) => candidate.type === 'enum');
      const target = pickFrom(enums, change.field);
      if (!target || target.type !== 'enum') {
        return null;
      }
      const values = ENUM_POOL.filter((_, position) => ((seed >> position) & 1) === 1);
      if (values.length === 0) {
        return null;
      }
      next = replace(
        withFields(
          definition,
          fields.map((candidate) =>
            candidate === target
              ? toggleSetting(target, {
                  ...target.settings,
                  values: values.map((value) => ({ value, label: value })),
                })
              : candidate,
          ),
        ),
      );
      break;
    }
    case 'flipMultiple':
    case 'flipCardinality':
    case 'flipRepeatable':
    case 'retarget':
    case 'swapComponent':
    case 'zoneAllowed':
    case 'formatVersion': {
      const wanted: Record<string, DataType[]> = {
        flipMultiple: ['enum', 'media'],
        flipCardinality: ['relation'],
        flipRepeatable: ['component'],
        retarget: ['relation'],
        swapComponent: ['component'],
        zoneAllowed: ['dynamiczone'],
        formatVersion: ['richtext'],
      };
      const candidates = fields.filter((candidate) => wanted[change.op]?.includes(candidate.type));
      const target = pickFrom(candidates, change.field);
      if (!target) {
        return null;
      }
      const settings = { ...(target.settings as Record<string, unknown>) };
      switch (change.op) {
        case 'flipMultiple':
          settings.multiple = !settings.multiple;
          break;
        case 'flipCardinality':
          settings.cardinality = settings.cardinality === 'one' ? 'many' : 'one';
          break;
        case 'flipRepeatable':
          settings.repeatable = !settings.repeatable;
          break;
        case 'retarget': {
          const others = RELATION_TARGETS.filter((candidate) => candidate !== settings.target);
          settings.target = pickFrom(others, seed);
          break;
        }
        case 'swapComponent': {
          const others = embeddableFor(schema, definition).filter(
            (candidate) => candidate !== settings.component,
          );
          const other = pickFrom(others, seed);
          if (!other) {
            return null;
          }
          settings.component = other;
          break;
        }
        case 'zoneAllowed': {
          const embeddable = embeddableFor(schema, definition);
          const allowed = embeddable.filter((_, position) => ((seed >> position) & 1) === 1);
          if (allowed.length === 0) {
            return null;
          }
          settings.components = allowed;
          break;
        }
        case 'formatVersion':
          settings.formatVersion = settings.formatVersion === 2 ? 1 : 2;
          break;
      }
      next = replace(
        withFields(
          definition,
          fields.map((candidate) => (candidate === target ? toggleSetting(target, settings) : candidate)),
        ),
      );
      break;
    }
    case 'flag': {
      if (!field) {
        return null;
      }
      const flag = FLAGS[seed % FLAGS.length] as (typeof FLAGS)[number];
      // Made required with a default where one can be given: the activation backfills it.
      const value = flag === 'required' && !field.required ? defaultFor(field) : undefined;
      next = replaceField({
        ...field,
        [flag]: !field[flag],
        ...(value !== undefined ? { defaultValue: value } : {}),
      });
      break;
    }
    case 'modelLocalized':
    case 'drafts': {
      const model = schema.model as SchemaDefinition & { localized?: boolean; draftAndPublish?: boolean };
      next =
        change.op === 'drafts'
          ? { ...schema, model: normalize({ ...model, draftAndPublish: !model.draftAndPublish }) }
          : {
              ...schema,
              model: normalize({
                ...model,
                localized: !model.localized,
                // A model that is not localized has no per-locale fields.
                fields: model.fields.map((candidate) => ({ ...candidate, localized: false })),
              }),
            };
      break;
    }
  }
  return next && isValidSchema(next) ? next : null;
};

// ---------------------------------------------------------------------------------------------------------
// Migration through the real planner and conversions

const head = (data: ContentData, locale = 'en'): ScannedHead => ({
  entry_id: uuid(0xe000),
  site_id: uuid(0xe001),
  model_id: MODEL_ID,
  locale,
  state: 'draft',
  revision_id: uuid(0xe002),
  data,
  autosaved_at: null,
  change_seq: '1',
});

/** The definition a change touched (by ID) in `next`. */
const changedDefinition = (
  previous: Schema,
  next: Schema,
): { before: SchemaDefinition; after: SchemaDefinition } | null => {
  const before = definitionsOf(previous);
  for (const after of definitionsOf(next)) {
    const old = before.find((candidate) => candidate.id === after.id);
    if (old && old !== after) {
      return { before: old, after };
    }
  }
  return null;
};

/**
 * The activation of `previous` → `next` (one changed definition) on one entry's data: the planner's plan, its
 * conversions (`proposeEntry`), then the checks the activation makes (a conversion without a converter, or a
 * value the new schema refuses, fails it). null: the activation is refused, so the schema does not change.
 */
export const migrate = (previous: Schema, next: Schema, data: Readonly<ContentData>): ContentData | null =>
  migrateHeads(previous, next, { en: data })?.en ?? null;

/** Draft data per locale (an entry's heads). */
export type Heads = Record<string, ContentData>;

/**
 * `migrate` for every head of one entry together (entry-level conversions: a field or model that stops being
 * localized unifies or drops locales; a model without drafts publishes them). The draft heads come back by
 * locale; null when the activation is refused for any of them.
 */
export const migrateHeads = (previous: Schema, next: Schema, heads: Readonly<Heads>): Heads | null => {
  const changed = changedDefinition(previous, next);
  if (!changed) {
    return structuredClone(heads);
  }
  const plan = buildChangePlan({
    before: changed.before,
    after: changed.after,
    fromVersion: 1,
    active: definitionsOf(previous).map((definition) => ({ definition, siteId: null })),
    siteId: null,
    hasContent: true,
  });
  if (plan.issues.length > 0) {
    return null;
  }
  const proposal = proposeEntry(
    Object.entries(heads).map(([locale, data]) => head(structuredClone(data), locale)),
    plan.prerequisites.flatMap((step) => (step.kind !== 'buildIndex' && isTransformStep(step) ? [step] : [])),
    'en',
  );
  if (proposal.failedSteps.size > 0) {
    return null;
  }
  const migrated: Heads = {};
  for (const proposed of proposal.heads) {
    if (proposed.state === 'draft') {
      migrated[proposed.locale] = proposed.data;
    }
  }
  return Object.values(migrated).every((data) => isValidData(next, data)) ? migrated : null;
};

/** `replay` over an entry's heads in every locale. */
export const replayHeads = (
  start: Schema,
  changes: readonly Change[],
  heads: Readonly<Heads>,
): { versions: Schema[]; heads: Heads[] } => {
  const versions = [start];
  const stored = [structuredClone(heads) as Heads];
  for (const change of changes) {
    const previous = versions[versions.length - 1] as Schema;
    const next = applyChange(previous, change);
    const migrated = next ? migrateHeads(previous, next, stored[stored.length - 1] as Heads) : null;
    if (next && migrated) {
      versions.push(next);
      stored.push(migrated);
    }
  }
  return { versions, heads: stored };
};

/**
 * One entry's heads in both locales, as storage holds them (ADR 0004): shared fields hold the same value in
 * every locale, per-locale fields their own. A model that is not localized has one head.
 */
export const headsArb = (schema: Schema): fc.Arbitrary<Heads> =>
  fc.tuple(dataArb(schema), dataArb(schema)).map(([en, other]): Heads => {
    if (!(schema.model as { localized?: boolean }).localized) {
      return { en };
    }
    const fr: ContentData = { ...en };
    for (const field of schema.model.fields) {
      if (field.localized) {
        if (other[field.id] === undefined) {
          delete fr[field.id];
        } else {
          fr[field.id] = other[field.id];
        }
      }
    }
    return { en, fr };
  });

/** The versions a change sequence goes through (V first, today last) and the data at each. */
export type History = { versions: Schema[]; data: ContentData[]; applied: Change[] };

/**
 * Applies the changes in order, each as its own activation, migrating `data` through each. A change that does
 * not apply, or whose activation would be refused for this data, is skipped (the schema stays).
 */
export const replay = (start: Schema, changes: readonly Change[], data: Readonly<ContentData>): History => {
  const versions = [start];
  const stored = [{ ...data }];
  const applied: Change[] = [];
  for (const change of changes) {
    const previous = versions[versions.length - 1] as Schema;
    const next = applyChange(previous, change);
    if (!next) {
      continue;
    }
    const migrated = migrate(previous, next, stored[stored.length - 1] as ContentData);
    if (!migrated) {
      continue;
    }
    versions.push(next);
    stored.push(migrated);
    applied.push(change);
  }
  return { versions, data: stored, applied };
};

/** Schema-only history (no data to migrate): every applicable change is applied. */
export const evolve = (start: Schema, changes: readonly Change[]): Schema[] => {
  const versions = [start];
  for (const change of changes) {
    const next = applyChange(versions[versions.length - 1] as Schema, change);
    if (next) {
      versions.push(next);
    }
  }
  return versions;
};

// ---------------------------------------------------------------------------------------------------------
// Walking definitions

/** Every field of the model and its components, by ID, with the definition that holds it. */
export const fieldsById = (
  schema: Schema,
): Map<string, { field: FieldDefinition; owner: SchemaDefinition }> =>
  new Map(
    definitionsOf(schema)
      .filter((definition) => definition.id === MODEL_ID || definition.kind === 'component')
      .flatMap((owner) => owner.fields.map((field) => [field.id, { field, owner }] as const)),
  );

export const componentById = (schema: Schema, id: string): SchemaDefinition | undefined =>
  schema.components.find((component) => component.id === id);

// ---------------------------------------------------------------------------------------------------------
// Compact descriptions (for counterexamples)

const describeField = (field: FieldDefinition): string => {
  const settings = field.settings as Record<string, unknown>;
  const bits: string[] = [field.type];
  if (field.type === 'enum') {
    bits.push(
      `[${field.settings.values.map((entry) => entry.value).join(',')}]${field.settings.multiple ? '*' : ''}`,
    );
  }
  if (field.type === 'media' && field.settings.multiple) bits.push('*');
  if (field.type === 'relation')
    bits.push(`→${String(settings.target).slice(-2)}:${field.settings.cardinality}`);
  if (field.type === 'component')
    bits.push(`→${String(settings.component).slice(-2)}${field.settings.repeatable ? '*' : ''}`);
  if (field.type === 'dynamiczone')
    bits.push(`→[${field.settings.components.map((id) => id.slice(-2)).join(',')}]`);
  if (field.type === 'richtext' && field.settings.formatVersion !== 1)
    bits.push(`v${field.settings.formatVersion}`);
  for (const flag of FLAGS) {
    const value = (field as unknown as Record<string, boolean>)[flag];
    if (flag === 'public' ? value === false : value === true) bits.push(flag === 'public' ? 'private' : flag);
  }
  return `${field.apiKey}#${field.id.slice(-4)}:${bits.join(' ')}`;
};

export const describeDefinition = (definition: SchemaDefinition): string =>
  `${definition.apiKey}#${definition.id.slice(-2)}{${definition.fields.map(describeField).join('; ')}}`;

export const describeSchema = (schema: Schema): string =>
  [schema.model, ...schema.components].map(describeDefinition).join(' | ');

export const describeVersions = (versions: readonly Schema[]): string =>
  versions.map((schema, index) => `  v${index}: ${describeSchema(schema)}`).join('\n');
