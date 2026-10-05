import { isCoverEligible, isDocumentPlaceable } from '../display/layout.js';
import { effectiveTitleField, TITLE_FIELD_TYPES } from '../display/titleField.js';
import { EDITOR_CATALOGUE, isCustomEditorId } from '../editors/catalogue.js';
import { isStableId } from '../ids.js';
import { SCALAR_DATA_TYPES, UNIQUE_CAPABLE_DATA_TYPES } from '../types/dataTypes.js';
import type { FieldDefinition, FieldGroup, ModelDefinition, SchemaDefinition } from '../types/definitions.js';
import { checkApiKeySyntax, foldApiKey, isApiKeySyntaxValid } from './apiKey.js';
import { checkDefaultValue } from './defaultValue.js';
import { issue, type ValidationIssue } from './issues.js';
import { RESERVED_DEFINITION_API_KEYS, RESERVED_FIELD_API_KEYS } from './naming.js';
import { collectSchemaErrors } from './typeboxIssues.js';

/**
 * Checks one normalized definition on its own: IDs, API keys, per-type settings, flags, editor choice and
 * display references. References to other definitions are checked by `validateSchema`.
 */
const RESERVED_FIELD_KEYS: ReadonlySet<string> = new Set(RESERVED_FIELD_API_KEYS.map(foldApiKey));
const RESERVED_DEFINITION_KEYS: ReadonlySet<string> = new Set(RESERVED_DEFINITION_API_KEYS.map(foldApiKey));
/** GraphQL enum values must be names and cannot be `true`, `false` or `null`. */
const RESERVED_ENUM_VALUES: ReadonlySet<string> = new Set(['true', 'false', 'null']);

type RangeCheck = { min: unknown; max: unknown; compare: (a: never, b: never) => number; path: string };

const compareNumbers = (a: number, b: number) => a - b;
const compareBigInts = (a: string, b: string) => {
  const diff = BigInt(a) - BigInt(b);
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
};
const compareDecimals = (a: string, b: string) => Number(a) - Number(b);
const compareText = (a: string, b: string) => (a === b ? 0 : a > b ? 1 : -1);

const checkRange = ({ min, max, compare, path }: RangeCheck): ValidationIssue[] =>
  min !== undefined && max !== undefined && compare(min as never, max as never) > 0
    ? [issue(path, 'INVALID_RANGE', 'minimum is greater than maximum')]
    : [];

const settingsRanges = (field: FieldDefinition, path: string): ValidationIssue[] => {
  const s = field.settings as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  issues.push(
    ...checkRange({ min: s.minLength, max: s.maxLength, compare: compareNumbers, path: `${path}/minLength` }),
  );
  switch (field.type) {
    case 'number':
    case 'integer':
    case 'media':
    case 'relation':
    case 'component':
    case 'dynamiczone':
      issues.push(...checkRange({ min: s.min, max: s.max, compare: compareNumbers, path: `${path}/min` }));
      break;
    case 'biginteger':
      issues.push(...checkRange({ min: s.min, max: s.max, compare: compareBigInts, path: `${path}/min` }));
      break;
    case 'decimal':
      issues.push(...checkRange({ min: s.min, max: s.max, compare: compareDecimals, path: `${path}/min` }));
      if (field.settings.scale !== undefined && field.settings.precision !== undefined) {
        issues.push(
          ...checkRange({
            min: field.settings.scale,
            max: field.settings.precision,
            compare: compareNumbers,
            path: `${path}/scale`,
          }),
        );
      }
      break;
    case 'date':
    case 'datetime':
    case 'time':
      issues.push(...checkRange({ min: s.min, max: s.max, compare: compareText, path: `${path}/min` }));
      break;
    default:
      break;
  }
  return issues;
};

const checkSettings = (
  field: FieldDefinition,
  path: string,
  definition: SchemaDefinition,
): ValidationIssue[] => {
  const issues = settingsRanges(field, `${path}/settings`);
  if (field.type === 'string' && field.settings.pattern !== undefined) {
    try {
      new RegExp(field.settings.pattern, 'u');
    } catch {
      issues.push(issue(`${path}/settings/pattern`, 'INVALID_PATTERN', 'is not a valid regular expression'));
    }
  }
  if (field.type === 'enum') {
    const seen = new Set<string>();
    field.settings.values.forEach((entry, index) => {
      const entryPath = `${path}/settings/values/${index}/value`;
      if (
        !isApiKeySyntaxValid(entry.value) ||
        entry.value.startsWith('__') ||
        RESERVED_ENUM_VALUES.has(entry.value)
      ) {
        issues.push(
          issue(
            entryPath,
            'INVALID_ENUM_VALUE',
            'enum values must be GraphQL names (letters, digits, _), not true/false/null',
          ),
        );
      }
      if (seen.has(entry.value)) {
        issues.push(issue(entryPath, 'DUPLICATE_ENUM_VALUE', `"${entry.value}" is listed twice`));
      }
      seen.add(entry.value);
    });
  }
  if (field.type === 'slug' && field.settings.sourceFieldId !== undefined) {
    const source = definition.fields.find((candidate) => candidate.id === field.settings.sourceFieldId);
    if (!source) {
      issues.push(
        issue(
          `${path}/settings/sourceFieldId`,
          'UNKNOWN_FIELD_REFERENCE',
          'refers to no field of this definition',
        ),
      );
    } else if (source.type !== 'string' && source.type !== 'text') {
      issues.push(
        issue(
          `${path}/settings/sourceFieldId`,
          'INVALID_FIELD_REFERENCE',
          'must refer to a string or text field',
        ),
      );
    }
  }
  if (field.type === 'richtext' && field.settings.formatVersion !== 1) {
    issues.push(
      issue(`${path}/settings/formatVersion`, 'INVALID_SETTINGS', 'unsupported rich-text format version'),
    );
  }
  if (field.type === 'relation' && !isStableId(field.settings.target)) {
    issues.push(issue(`${path}/settings/target`, 'INVALID_ID', 'must be the ID of a model'));
  }
  if (field.type === 'component' && !isStableId(field.settings.component)) {
    issues.push(issue(`${path}/settings/component`, 'INVALID_ID', 'must be the ID of a component'));
  }
  if (field.type === 'dynamiczone') {
    field.settings.components.forEach((id, index) => {
      if (!isStableId(id)) {
        issues.push(
          issue(`${path}/settings/components/${index}`, 'INVALID_ID', 'must be the ID of a component'),
        );
      }
    });
  }
  return issues;
};

const checkFlags = (field: FieldDefinition, path: string, isComponent: boolean): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const reject = (flag: string, why: string) =>
    issues.push(issue(`${path}/${flag}`, 'UNSUPPORTED_FLAG', why));
  if (field.unique && !UNIQUE_CAPABLE_DATA_TYPES.has(field.type)) {
    reject('unique', `${field.type} fields cannot be unique`);
  }
  for (const flag of ['filterable', 'sortable'] as const) {
    if (field[flag] && !SCALAR_DATA_TYPES.has(field.type)) {
      reject(flag, `${field.type} fields cannot be ${flag}`);
    }
    if (field[flag] && field.type === 'enum' && field.settings.multiple) {
      reject(flag, `multi-value enum fields cannot be ${flag}`);
    }
  }
  if (isComponent) {
    // Component values live inside a parent entry field; uniqueness and indexes apply to entry fields only.
    for (const flag of ['unique', 'filterable', 'sortable'] as const) {
      if (field[flag]) {
        reject(flag, `fields of a component cannot be ${flag}`);
      }
    }
  }
  if (field.deprecated && field.required) {
    reject('required', 'a deprecated field cannot be required');
  }
  return issues;
};

const checkEditor = (field: FieldDefinition, path: string): ValidationIssue[] => {
  const { id, options } = field.editor;
  if (isCustomEditorId(id)) {
    return [];
  }
  const entry = EDITOR_CATALOGUE.get(id);
  if (!entry) {
    return [
      issue(
        `${path}/editor/id`,
        'UNKNOWN_EDITOR',
        `"${id}" is not a built-in editor (custom editors use a vendor.name ID)`,
      ),
    ];
  }
  if (!entry.dataTypes.includes(field.type) || !(entry.supports?.(field) ?? true)) {
    return [
      issue(
        `${path}/editor/id`,
        'INCOMPATIBLE_EDITOR',
        `the ${id} editor cannot edit this ${field.type} field`,
      ),
    ];
  }
  return collectSchemaErrors(entry.optionsSchema, options, `${path}/editor/options`).map((error) =>
    issue(error.path, 'INVALID_EDITOR_OPTIONS', error.message),
  );
};

const checkField = (
  field: FieldDefinition,
  index: number,
  definition: SchemaDefinition,
): ValidationIssue[] => {
  const path = `/fields/${index}`;
  const issues: ValidationIssue[] = [];
  if (!isStableId(field.id)) {
    issues.push(issue(`${path}/id`, 'INVALID_ID', 'must be a lower-case UUID'));
  }
  const syntax = checkApiKeySyntax(field.apiKey);
  if (syntax) {
    issues.push(issue(`${path}/apiKey`, syntax.code, syntax.message));
  } else if (RESERVED_FIELD_KEYS.has(foldApiKey(field.apiKey))) {
    issues.push(issue(`${path}/apiKey`, 'API_KEY_RESERVED', `"${field.apiKey}" is a system field name`));
  }
  issues.push(...checkSettings(field, path, definition));
  issues.push(...checkFlags(field, path, definition.kind === 'component'));
  const defaultProblem = checkDefaultValue(field);
  if (defaultProblem) {
    issues.push(issue(`${path}/defaultValue`, 'INVALID_DEFAULT_VALUE', defaultProblem));
  }
  issues.push(...checkEditor(field, path));
  return issues;
};

const checkFieldUniqueness = (definition: SchemaDefinition): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  const keys = new Map<string, string>();
  definition.fields.forEach((field, index) => {
    if (ids.has(field.id)) {
      issues.push(issue(`/fields/${index}/id`, 'DUPLICATE_ID', 'another field has the same ID'));
    }
    ids.add(field.id);
    const folded = foldApiKey(field.apiKey);
    const clash = keys.get(folded);
    if (clash !== undefined) {
      issues.push(
        issue(
          `/fields/${index}/apiKey`,
          'API_KEY_COLLISION',
          `"${field.apiKey}" collides with field "${clash}" (keys are case-insensitive)`,
        ),
      );
    }
    keys.set(folded, field.apiKey);
  });
  return issues;
};

const checkGroups = (
  groups: readonly FieldGroup[] | undefined,
  fieldIds: ReadonlySet<string>,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const groupIds = new Set<string>();
  const placed = new Set<string>();
  (groups ?? []).forEach((group, groupIndex) => {
    if (groupIds.has(group.id)) {
      issues.push(
        issue(`/display/groups/${groupIndex}/id`, 'DUPLICATE_GROUP', 'another group has the same ID'),
      );
    }
    groupIds.add(group.id);
    group.fieldIds.forEach((fieldId, index) => {
      const path = `/display/groups/${groupIndex}/fieldIds/${index}`;
      if (!fieldIds.has(fieldId)) {
        issues.push(issue(path, 'UNKNOWN_FIELD_REFERENCE', 'refers to no field of this definition'));
      } else if (placed.has(fieldId)) {
        issues.push(issue(path, 'INVALID_FIELD_REFERENCE', 'a field can be in one group only'));
      }
      placed.add(fieldId);
    });
  });
  return issues;
};

type FieldReferenceCheck = {
  path: string;
  fields: ReadonlyMap<string, FieldDefinition>;
  /** Returns why the field can't be used here, or undefined when it can. */
  reject: (field: FieldDefinition) => string | undefined;
};

/** A list of field IDs: each must exist, appear once and pass `reject`. */
const checkFieldList = (
  ids: readonly string[] | undefined,
  check: FieldReferenceCheck,
): ValidationIssue[] => {
  const seen = new Set<string>();
  return (ids ?? []).flatMap((fieldId, index) => {
    const path = `${check.path}/${index}`;
    const field = check.fields.get(fieldId);
    if (!field) {
      return [issue(path, 'UNKNOWN_FIELD_REFERENCE', 'refers to no field of this definition')];
    }
    if (seen.has(fieldId)) {
      return [issue(path, 'INVALID_FIELD_REFERENCE', 'the field is listed more than once')];
    }
    seen.add(fieldId);
    const reason = check.reject(field);
    return reason ? [issue(path, 'INVALID_FIELD_REFERENCE', reason)] : [];
  });
};

/**
 * The entry document's layout (`effectiveLayout`): document fields, cover and strip. Title, cover and
 * canvas are disjoint: any field but the title (configured or automatic) may be in the canvas, the
 * configured cover may not; strip entries are properties, so never the cover or a document field.
 */
const checkDocumentLayout = (
  model: ModelDefinition,
  fields: ReadonlyMap<string, FieldDefinition>,
): ValidationIssue[] => {
  const { canvasFieldIds, coverFieldId, stripFieldIds } = model.display;
  const canvas = new Set(canvasFieldIds ?? []);
  const title = effectiveTitleField(model);
  const issues = checkFieldList(canvasFieldIds, {
    path: '/display/canvasFieldIds',
    fields,
    reject: (field) =>
      isDocumentPlaceable(field, title)
        ? undefined
        : 'the title is the heading of the document, not a field in it',
  });
  if (coverFieldId !== undefined) {
    issues.push(
      ...checkFieldList([coverFieldId], {
        path: '/display/coverFieldId',
        fields,
        reject: (field) =>
          !isCoverEligible(field)
            ? 'the cover must be a single media field that allows images'
            : canvas.has(field.id)
              ? 'the cover cannot also be in the canvas'
              : undefined,
      }).map((found) => ({ ...found, path: '/display/coverFieldId' })),
    );
  }
  issues.push(
    ...checkFieldList(stripFieldIds, {
      path: '/display/stripFieldIds',
      fields,
      reject: (field) =>
        canvas.has(field.id) || field.id === coverFieldId
          ? 'the strip shows properties, not the cover or canvas blocks'
          : undefined,
    }),
  );
  return issues;
};

const checkDisplay = (definition: SchemaDefinition): ValidationIssue[] => {
  const fields = new Map(definition.fields.map((field) => [field.id, field]));
  const fieldIds = new Set(fields.keys());
  const issues: ValidationIssue[] = [];
  const { titleFieldId } = definition.display;
  if (titleFieldId !== undefined) {
    const title = fields.get(titleFieldId);
    if (!title) {
      issues.push(
        issue('/display/titleFieldId', 'UNKNOWN_FIELD_REFERENCE', 'refers to no field of this definition'),
      );
    } else if (!TITLE_FIELD_TYPES.has(title.type)) {
      issues.push(
        issue(
          '/display/titleFieldId',
          'INVALID_FIELD_REFERENCE',
          `a ${title.type} field cannot be the title`,
        ),
      );
    }
  }
  if (definition.kind !== 'component') {
    definition.display.listFieldIds?.forEach((fieldId, index) => {
      if (!fieldIds.has(fieldId)) {
        issues.push(
          issue(
            `/display/listFieldIds/${index}`,
            'UNKNOWN_FIELD_REFERENCE',
            'refers to no field of this definition',
          ),
        );
      }
    });
    const sort = definition.display.defaultSort;
    if (sort) {
      const field = fields.get(sort.fieldId);
      if (!field) {
        issues.push(
          issue(
            '/display/defaultSort/fieldId',
            'UNKNOWN_FIELD_REFERENCE',
            'refers to no field of this definition',
          ),
        );
      } else if (!field.sortable) {
        issues.push(
          issue(
            '/display/defaultSort/fieldId',
            'INVALID_FIELD_REFERENCE',
            'the default sort field must be sortable',
          ),
        );
      }
    }
    issues.push(...checkDocumentLayout(definition, fields));
  }
  issues.push(...checkGroups(definition.display.groups, fieldIds));
  return issues;
};

/**
 * A collection's plural API ID follows the API ID rules and must differ from its singular. Singletons and
 * components have none (normalizing drops it).
 */
const checkPluralApiKey = (definition: SchemaDefinition): ValidationIssue[] => {
  if (definition.kind !== 'collection' || definition.pluralApiKey === undefined) {
    return [];
  }
  const syntax = checkApiKeySyntax(definition.pluralApiKey, 'plural API ID');
  if (syntax) {
    return [issue('/pluralApiKey', syntax.code, syntax.message)];
  }
  if (foldApiKey(definition.pluralApiKey) === foldApiKey(definition.apiKey)) {
    return [
      issue(
        '/pluralApiKey',
        'PLURAL_API_KEY_SAME_AS_SINGULAR',
        'the plural API ID must differ from the API ID (case-insensitively)',
      ),
    ];
  }
  return [];
};

/** All problems with one definition, in document order. Empty means valid on its own. */
export const validateDefinition = (definition: SchemaDefinition): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (!isStableId(definition.id)) {
    issues.push(issue('/id', 'INVALID_ID', 'must be a lower-case UUID'));
  }
  const syntax = checkApiKeySyntax(definition.apiKey);
  if (syntax) {
    issues.push(issue('/apiKey', syntax.code, syntax.message));
  } else if (RESERVED_DEFINITION_KEYS.has(foldApiKey(definition.apiKey))) {
    issues.push(issue('/apiKey', 'API_KEY_RESERVED', `"${definition.apiKey}" is reserved by the admin`));
  }
  // A plural derived from an invalid API ID is invalid too; report the API ID once.
  if (!syntax) {
    issues.push(...checkPluralApiKey(definition));
  }
  definition.fields.forEach((field, index) => issues.push(...checkField(field, index, definition)));
  issues.push(...checkFieldUniqueness(definition));
  issues.push(...checkDisplay(definition));
  return issues;
};
