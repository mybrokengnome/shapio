import { STORAGE_FAMILY, type DataType } from '../types/dataTypes.js';
import type { FieldDefinition, SchemaDefinition } from '../types/definitions.js';
import type { SchemaChange } from './types.js';

/**
 * Change classification (brief §5, ADR 0002). Each change gets a category, whether it needs prerequisite
 * work before the new revision can be activated, and flags for breaking API contracts and destroying data.
 *
 * | Brief §5 row                         | category                         | activation                    |
 * | ------------------------------------ | -------------------------------- | ----------------------------- |
 * | Label, help text, editor layout      | metadata                         | immediate                     |
 * | Compatible editor swap               | editorSwap                       | immediate                     |
 * | Optional field or new model          | additive                         | immediate (live)              |
 * | Required field                       | requiredField                    | validateRequired / backfill   |
 * | Type or rich-text format conversion  | conversion                       | convert (+ validate)          |
 * | API key rename                       | contract (breaking)              | immediate, needs ack          |
 * | Field removal                        | removal (breaking, data kept)    | immediate, needs ack          |
 * | Unique/index constraint              | constraint / index               | checkUnique / buildIndex      |
 * | (plus) type change of a unique field | as its type change               | + checkUnique                 |
 * | (plus) tightened validation rules    | validation                       | validateValues                |
 * | (plus) localized true→false          | conversion (destructive)         | convert                       |
 */
export type ChangeCategory =
  | 'metadata'
  | 'editorSwap'
  | 'additive'
  | 'requiredField'
  | 'validation'
  | 'conversion'
  | 'contract'
  | 'removal'
  | 'constraint'
  | 'index';

/** Work that must succeed before activation. Content-touching kinds run through the content ports. */
export type PrerequisiteKind =
  'validateRequired' | 'backfill' | 'validateValues' | 'checkUnique' | 'buildIndex' | 'convert';

/** Work done after activation, once nothing reads the old structure. */
export type CleanupKind = 'dropIndex' | 'releaseUnique';

export type ClassifiedChange = SchemaChange & {
  category: ChangeCategory;
  /** Changes the public API contract (REST/GraphQL shape or visibility); needs explicit acknowledgement. */
  breaking: boolean;
  /** Loses stored information that a schema rollback cannot restore. */
  destructive: boolean;
  /** False for conversions Shapio cannot perform; the planner refuses them. */
  supported: boolean;
  prerequisites: PrerequisiteKind[];
  cleanup: CleanupKind[];
};

export type ClassifyContext = { before: SchemaDefinition | null; after: SchemaDefinition | null };

type Classification = Omit<ClassifiedChange, keyof SchemaChange>;

const result = (category: ChangeCategory, extra: Partial<Classification> = {}): Classification => ({
  category,
  breaking: false,
  destructive: false,
  supported: true,
  prerequisites: [],
  cleanup: [],
  ...extra,
});

const findField = (
  definition: SchemaDefinition | null,
  fieldId: string | undefined,
): FieldDefinition | undefined => definition?.fields.find((field) => field.id === fieldId);

const hasIndex = (field: FieldDefinition | undefined): boolean =>
  Boolean(field && (field.filterable || field.sortable));

/** Names delivery APIs use for a type; a change of name is a contract change. */
const API_SCALAR: Readonly<Record<DataType, string>> = {
  string: 'String',
  text: 'String',
  code: 'String',
  slug: 'String',
  email: 'String',
  url: 'String',
  uid: 'String',
  enum: 'Enum',
  date: 'Date',
  datetime: 'DateTime',
  time: 'Time',
  number: 'Float',
  integer: 'Int',
  decimal: 'Decimal',
  biginteger: 'BigInt',
  boolean: 'Boolean',
  json: 'JSON',
  richtext: 'RichText',
  media: 'Media',
  relation: 'Relation',
  component: 'Component',
  dynamiczone: 'DynamicZone',
};

const PLAIN_TEXT_TYPES: ReadonlySet<DataType> = new Set(['string', 'text']);
/** Types any string value is valid for, so a same-family change to one without constraints only widens. */
const TEXT_TARGETS: ReadonlySet<DataType> = new Set(['string', 'text', 'code']);
const SCALAR_FAMILIES = new Set(['jsonString', 'jsonNumber', 'numericString', 'boolean']);

const hasTextConstraints = (field: FieldDefinition | undefined) => {
  const settings = (field?.settings ?? {}) as Record<string, unknown>;
  return (
    settings.minLength !== undefined ||
    settings.maxLength !== undefined ||
    settings.pattern !== undefined ||
    settings.validate === true
  );
};

/**
 * A type change. Within one storage family the stored JSON stays as it is: widening is live, anything else
 * re-validates existing values. Across families Shapio converts values with a job, for the pairs it knows.
 */
const classifyTypeChange = (
  from: DataType,
  to: DataType,
  after: FieldDefinition | undefined,
): Classification => {
  // A code field has no filters (REST operators, GraphQL `XFilter` key), so becoming one is breaking.
  const breaking = API_SCALAR[from] !== API_SCALAR[to] || (to === 'code' && from !== 'code');
  const fromFamily = STORAGE_FAMILY[from];
  const toFamily = STORAGE_FAMILY[to];
  if (fromFamily === toFamily) {
    const widening =
      (fromFamily === 'jsonString' && TEXT_TARGETS.has(to) && !hasTextConstraints(after)) ||
      (from === 'integer' && to === 'number') ||
      (from === 'biginteger' &&
        to === 'decimal' &&
        after?.type === 'decimal' &&
        after.settings.precision === undefined);
    return widening
      ? result('additive', { breaking })
      : result('validation', { breaking, prerequisites: ['validateValues'] });
  }
  const numericPair =
    (fromFamily === 'jsonNumber' && toFamily === 'numericString') ||
    (fromFamily === 'numericString' && toFamily === 'jsonNumber');
  const toText = SCALAR_FAMILIES.has(fromFamily) && PLAIN_TEXT_TYPES.has(to);
  const textToRichtext = fromFamily === 'jsonString' && from !== 'code' && to === 'richtext';
  const richtextToText = from === 'richtext' && PLAIN_TEXT_TYPES.has(to);
  const supported = numericPair || toText || textToRichtext || richtextToText;
  return result('conversion', {
    breaking,
    supported,
    destructive: richtextToText,
    prerequisites: supported ? ['convert', 'validateValues'] : [],
  });
};

type Comparable = number | string;
const compareValues = (a: Comparable, b: Comparable): number => {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  try {
    const diff = BigInt(String(a)) - BigInt(String(b));
    return diff === 0n ? 0 : diff > 0n ? 1 : -1;
  } catch {
    const numeric = Number(a) - Number(b);
    return Number.isNaN(numeric) ? String(a).localeCompare(String(b)) : numeric;
  }
};

/** A lower bound (min, minLength) that appears or rises, or an upper bound that appears or falls. */
const isTightened = (bound: 'lower' | 'upper', from: unknown, to: unknown): boolean => {
  if (to === undefined || to === null) {
    return false;
  }
  if (from === undefined || from === null) {
    return true;
  }
  const order = compareValues(from as Comparable, to as Comparable);
  return bound === 'lower' ? order < 0 : order > 0;
};

const asStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) =>
        typeof entry === 'object' && entry !== null
          ? String((entry as { value?: unknown }).value)
          : String(entry),
      )
    : [];

const removesAny = (from: unknown, to: unknown): boolean => {
  const kept = new Set(asStrings(to));
  return asStrings(from).some((entry) => !kept.has(entry));
};

const validation = (tightened: boolean) =>
  tightened ? result('validation', { prerequisites: ['validateValues'] }) : result('additive');

const classifySettingsChange = (change: SchemaChange): Classification => {
  const { property, from, to } = change;
  switch (property) {
    case 'minLength':
    case 'min':
      return validation(isTightened('lower', from, to));
    case 'maxLength':
    case 'max':
    case 'precision':
    case 'scale':
      return validation(isTightened('upper', from, to));
    case 'pattern':
      return validation(to !== undefined);
    case 'values':
      // Removing an enum value invalidates entries using it; adding values or relabelling does not.
      return validation(removesAny(from, to));
    case 'components':
    case 'allowedKinds':
    case 'protocols':
      // Narrowing the allowed set re-validates; an absent allowedKinds/protocols list means "any".
      return validation(to !== undefined && (from === undefined || removesAny(from, to)));
    case 'sourceFieldId':
    case 'language':
      // A code field's language is a label for readers; the stored string is the same.
      return result('metadata');
    case 'validate':
      return validation(to === true);
    case 'multiple':
    case 'repeatable':
    case 'cardinality': {
      const becomesSingle = to === false || to === 'one';
      return result('conversion', {
        breaking: true,
        destructive: becomesSingle,
        prerequisites: ['convert', 'validateValues'],
      });
    }
    case 'formatVersion':
      return result('conversion', { prerequisites: ['convert', 'validateValues'] });
    case 'target':
    case 'component':
      // Existing values point at entries of the old target; they are cleared by the conversion.
      return result('conversion', { breaking: true, destructive: true, prerequisites: ['convert'] });
    default:
      // An unknown setting: be safe and re-validate existing values.
      return result('validation', { prerequisites: ['validateValues'] });
  }
};

const classifyFieldChange = (change: SchemaChange, { before, after }: ClassifyContext): Classification => {
  const previous = findField(before, change.fieldId);
  const field = findField(after, change.fieldId);
  switch (change.kind) {
    case 'field.added': {
      const prerequisites: Classification['prerequisites'] = [];
      if (field?.required) {
        prerequisites.push(field.defaultValue !== undefined ? 'backfill' : 'validateRequired');
      }
      if (field?.unique) {
        prerequisites.push('checkUnique');
      }
      if (hasIndex(field)) {
        prerequisites.push('buildIndex');
      }
      return result(field?.required ? 'requiredField' : 'additive', { prerequisites });
    }
    case 'field.removed':
      // Values stay in stored revisions; removing them is a separate, explicit cleanup.
      return result('removal', {
        breaking: true,
        cleanup: [
          ...(hasIndex(previous) ? (['dropIndex'] as const) : []),
          ...(previous?.unique ? (['releaseUnique'] as const) : []),
        ],
      });
    case 'field.order':
    case 'field.metadata':
      return result('metadata');
    case 'field.editor':
      return result('editorSwap');
    case 'field.apiKey':
      return result('contract', { breaking: true });
    case 'field.type': {
      const classification = classifyTypeChange(change.from as DataType, change.to as DataType, field);
      // A unique field's values may normalize differently under the new type (e.g. string → email ignores
      // case): check them for duplicates before activation.
      return field?.unique && previous?.unique && !classification.prerequisites.includes('checkUnique')
        ? { ...classification, prerequisites: [...classification.prerequisites, 'checkUnique'] }
        : classification;
    }
    case 'field.required':
      if (change.to !== true) {
        return result('additive');
      }
      return result('requiredField', {
        prerequisites: [field?.defaultValue !== undefined ? 'backfill' : 'validateRequired'],
      });
    case 'field.localized': {
      const modelLocalized = after?.kind !== 'component' && after?.localized === true;
      if (!modelLocalized) {
        return result('metadata');
      }
      // false→true: every locale's head already holds the shared value (ADR 0004), so nothing to copy.
      return change.to === true
        ? result('additive')
        : result('conversion', { destructive: true, prerequisites: ['convert'] });
    }
    case 'field.public':
    case 'field.deprecated': {
      const hides = change.kind === 'field.public' ? change.to === false : change.to === true;
      return result('metadata', { breaking: hides });
    }
    case 'field.unique':
      return change.to === true
        ? result('constraint', { prerequisites: ['checkUnique'] })
        : result('additive', { cleanup: ['releaseUnique'] });
    case 'field.filterable':
    case 'field.sortable': {
      // Filtering and sorting share one expression index per field.
      if (hasIndex(field) && !hasIndex(previous)) {
        return result('index', { prerequisites: ['buildIndex'] });
      }
      if (!hasIndex(field) && hasIndex(previous)) {
        return result('index', { cleanup: ['dropIndex'] });
      }
      return result('metadata');
    }
    case 'field.settings':
      return classifySettingsChange(change);
    default:
      return result('metadata');
  }
};

/** Classifies one change in the context of the definitions it was diffed from. */
export const classifyChange = (change: SchemaChange, context: ClassifyContext): ClassifiedChange => {
  let classification: Classification;
  switch (change.kind) {
    case 'definition.added':
      classification = result('additive');
      break;
    case 'definition.removed':
      // Soft delete: entries are kept and reappear if the definition is restored.
      classification = result('removal', { breaking: true });
      break;
    case 'definition.apiKey':
    case 'definition.pluralApiKey':
      classification = result('contract', { breaking: true });
      break;
    case 'definition.metadata':
      classification = result('metadata');
      break;
    case 'model.kind':
      classification =
        change.to === 'singleton'
          ? result('validation', { breaking: true, prerequisites: ['validateValues'] })
          : result('contract', { breaking: true });
      break;
    case 'model.localized':
      classification =
        change.to === true
          ? result('additive')
          : result('conversion', { destructive: true, prerequisites: ['convert'] });
      break;
    case 'model.draftAndPublish':
      classification =
        change.to === true
          ? result('additive')
          : result('conversion', { destructive: true, prerequisites: ['convert'] });
      break;
    default:
      classification = classifyFieldChange(change, context);
  }
  return { ...change, ...classification };
};

export const classifyChanges = (
  changes: readonly SchemaChange[],
  context: ClassifyContext,
): ClassifiedChange[] => changes.map((change) => classifyChange(change, context));

export type ChangeSummary = {
  breaking: boolean;
  destructive: boolean;
  supported: boolean;
  prerequisites: PrerequisiteKind[];
  cleanup: CleanupKind[];
  /** True when nothing but metadata/editor changes are involved. */
  metadataOnly: boolean;
};

const PREREQUISITE_ORDER: readonly PrerequisiteKind[] = [
  'convert',
  'backfill',
  'validateRequired',
  'validateValues',
  'checkUnique',
  'buildIndex',
];

export const summarizeChanges = (changes: readonly ClassifiedChange[]): ChangeSummary => {
  const prerequisites = new Set(changes.flatMap((change) => change.prerequisites));
  return {
    breaking: changes.some((change) => change.breaking),
    destructive: changes.some((change) => change.destructive),
    supported: changes.every((change) => change.supported),
    prerequisites: PREREQUISITE_ORDER.filter((kind) => prerequisites.has(kind)),
    cleanup: [...new Set(changes.flatMap((change) => change.cleanup))],
    metadataOnly: changes.every(
      (change) => change.category === 'metadata' || change.category === 'editorSwap',
    ),
  };
};

/** Locale configuration changes (ADR 0002/0004). Locales are global, so they are planned on their own. */
export type LocaleChangeKind =
  'locale.added' | 'locale.removed' | 'locale.defaultChanged' | 'locale.metadata';

export type ClassifiedLocaleChange = {
  kind: LocaleChangeKind;
  code: string;
  category: ChangeCategory;
  breaking: boolean;
  destructive: boolean;
};

/**
 * - added: live (entries gain the locale as editors fill it in);
 * - removed: destroys that locale's content (purged by a follow-up job), so it needs explicit consent;
 * - default changed: delivery falls back to a different locale, a contract change for API consumers;
 * - label or fallback chain: metadata.
 */
export const classifyLocaleChange = (kind: LocaleChangeKind, code: string): ClassifiedLocaleChange => {
  switch (kind) {
    case 'locale.added':
      return { kind, code, category: 'additive', breaking: false, destructive: false };
    case 'locale.removed':
      return { kind, code, category: 'removal', breaking: true, destructive: true };
    case 'locale.defaultChanged':
      return { kind, code, category: 'contract', breaking: true, destructive: false };
    default:
      return { kind, code, category: 'metadata', breaking: false, destructive: false };
  }
};
