import {
  findInvalidText,
  INVALID_TEXT_MESSAGE,
  isComponentDefinition,
  isEmptyRichText,
  richTextMediaIds,
  SCALAR_DATA_TYPES,
  type ComponentDefinition,
  type FieldDefinition,
  type SchemaDefinition,
  validateRichText,
} from '@shapio/schema';
import type { ContentData } from '../../db/contentData.js';
import type { SchemaById } from '../../schema/snapshot.js';
import { findFieldByApiKey, type ContentModel } from '../model.js';
import { relationTargetFor, relationTargetKey, type RelationTarget } from '../relationTarget.js';
import { pointer, type ContentIssue } from './issues.js';
import { checkLength, checkScalar, isReferenceId } from './scalars.js';

/**
 * The content validator (build plan §4.E2). Built from the active model and the components it embeds,
 * compiled once per combination of schema revisions and cached. Values arrive keyed by API keys at the
 * boundary (`fromInput`) and are validated in storage form, keyed by stable field IDs (`validate`).
 *
 * Storage format of structured values:
 * - component: an object keyed by the component's field IDs (an array of them when repeatable);
 * - dynamic zone: an array of such objects, each with `__component` holding the component's stable ID
 *   (its API key at the boundary);
 * - relation: the target entry ID (`one`) or an ordered array of IDs (`many`);
 * - media: an asset ID, or an array of them when `multiple`.
 * Missing values (absent, null, empty string, empty list, empty rich text) are not stored.
 * Keys that no field defines (values of removed fields) are preserved untouched (brief §5: field removal
 * keeps values until an explicit cleanup); deprecated fields' values are kept but not validated.
 */
export const COMPONENT_KEY = '__component';
/**
 * The API ID of an entry's own model on every delivered entry (plan polymorphic-types). A system attribute:
 * never a field (API IDs may not start with `__`), so a write naming it fails as an unknown field.
 */
export const MODEL_KEY = '__model';
/**
 * The singular API IDs of an entry's kind lineage on every delivered entry, root first and its own kind last
 * (plan polymorphic-types). A system attribute like `MODEL_KEY`: never a field, never written.
 */
export const KINDS_KEY = '__kinds';

/**
 * A relation value to check: `targetModelIds` are the models an entry may be of at the validator's snapshot:
 * the target's family (plan polymorphic-types) or an interface's members (plan interfaces); null for a
 * relation to any entry (`*`), which accepts a live entry of any model on the site. `targetModelId` is the
 * stored target (a model ID, an interface ID, or `*`).
 */
export type RelationReference = {
  path: string;
  fieldId: string;
  targetModelId: string;
  targetModelIds: readonly string[] | null;
  entryIds: string[];
  /**
   * What the target accepts, in words, for a refusal (`entry … is not a Featurable (a Blog post or Guide)`);
   * absent for a model target, whose refusal says the entry is not in it.
   */
  accepts?: string;
};

/** Media a document points at (media fields and rich-text images), checked against the library on write. */
export type MediaReferenceCheck = {
  path: string;
  assetIds: string[];
  allowedKinds: readonly string[] | null;
};

export type ValidateOptions = {
  /** Autosave: everything but `required` is enforced, so half-finished drafts can be kept. */
  skipRequired?: boolean;
};

export type ValidationOutcome = {
  data: ContentData;
  issues: ContentIssue[];
  relations: RelationReference[];
  media: MediaReferenceCheck[];
};

export type ModelValidator = {
  model: ContentModel;
  /** Maps an API-keyed patch to storage form. Unknown or deprecated keys are reported, not dropped silently. */
  fromInput: (input: Readonly<Record<string, unknown>>) => { patch: ContentData; issues: ContentIssue[] };
  /** Validates and canonicalizes a complete document in storage form. */
  validate: (data: Readonly<ContentData>, options?: ValidateOptions) => ValidationOutcome;
};

/** Relation target (as stored) → what it accepts at the snapshot, and that in words for a refusal. */
type TargetFamilies = ReadonlyMap<string, { target: RelationTarget; accepts?: string }>;

type Walk = ValidationOutcome & { options: ValidateOptions; families: TargetFamilies };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The models a relation value's entries may be of; null for any entry. */
const acceptedModelIds = (target: RelationTarget | undefined, stored: string): readonly string[] | null =>
  target === undefined ? [stored] : target.kind === 'any' ? null : target.modelIds;

export const isMissingValue = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

const issue = (
  walk: { issues: ContentIssue[] },
  path: string,
  code: ContentIssue['code'],
  message: string,
) => {
  walk.issues.push({ path, code, message });
  return undefined;
};

type Components = ReadonlyMap<string, ComponentDefinition>;

const checkCount = (walk: Walk, path: string, count: number, settings: { min?: number; max?: number }) => {
  if (settings.min !== undefined && count < settings.min) {
    issue(walk, path, 'TOO_FEW', `needs at least ${settings.min} item(s)`);
  }
  if (settings.max !== undefined && count > settings.max) {
    issue(walk, path, 'TOO_MANY', `allows at most ${settings.max} item(s)`);
  }
};

const checkReferences = (walk: Walk, path: string, value: unknown, multiple: boolean) => {
  const ids = multiple ? value : [value];
  if (!Array.isArray(ids) || !ids.every(isReferenceId)) {
    return issue(walk, path, 'INVALID_TYPE', multiple ? 'must be a list of IDs' : 'must be an ID');
  }
  if (new Set(ids).size !== ids.length) {
    return issue(walk, path, 'DUPLICATE', 'lists an ID twice');
  }
  return ids;
};

const validateFields = (
  definition: SchemaDefinition,
  data: Readonly<Record<string, unknown>>,
  path: string,
  walk: Walk,
  components: Components,
): Record<string, unknown> => {
  const known = new Set(definition.fields.map((field) => field.id));
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!known.has(key) && key !== COMPONENT_KEY) {
      output[key] = value;
    }
  }
  for (const field of definition.fields) {
    const value = data[field.id];
    if (field.deprecated) {
      if (value !== undefined) {
        output[field.id] = value;
      }
      continue;
    }
    const at = pointer(path, field.apiKey);
    // Components and zones are walked field by field; any other value is checked whole (json keys too).
    const invalidText =
      field.type === 'component' || field.type === 'dynamiczone' ? undefined : findInvalidText(value, at);
    if (invalidText !== undefined) {
      issue(walk, invalidText, 'INVALID_TEXT', INVALID_TEXT_MESSAGE);
      continue;
    }
    const checked = checkField(field, value, at, walk, components);
    if (checked !== undefined) {
      output[field.id] = checked;
    }
  }
  return output;
};

const checkComponentObject = (
  component: ComponentDefinition,
  value: unknown,
  path: string,
  walk: Walk,
  components: Components,
) =>
  isRecord(value)
    ? validateFields(component, value, path, walk, components)
    : issue(walk, path, 'INVALID_TYPE', 'must be an object');

const isJson = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/** A code value is stored exactly as written: never trimmed, parsed into storage or rewritten. */
const checkCode = (field: FieldDefinition<'code'>, value: unknown, path: string, walk: Walk) => {
  if (typeof value !== 'string') {
    return issue(walk, path, 'INVALID_TYPE', 'must be a string');
  }
  const length = checkLength(value, field.settings);
  if (!length.ok) {
    return issue(walk, path, length.code, length.message);
  }
  if (field.settings.validate && field.settings.language === 'json' && !isJson(value)) {
    return issue(walk, path, 'INVALID_FORMAT', 'must be valid JSON');
  }
  return value;
};

const checkStructured = (
  field: FieldDefinition,
  value: unknown,
  path: string,
  walk: Walk,
  components: Components,
): unknown => {
  switch (field.type) {
    case 'component': {
      const component = components.get(field.settings.component);
      if (!component) {
        return issue(walk, path, 'UNKNOWN_COMPONENT', 'refers to a component that does not exist');
      }
      if (!field.settings.repeatable) {
        return checkComponentObject(component, value, path, walk, components);
      }
      if (!Array.isArray(value)) {
        return issue(walk, path, 'INVALID_TYPE', 'must be a list');
      }
      checkCount(walk, path, value.length, field.settings);
      return value.map((item, index) =>
        checkComponentObject(component, item, pointer(path, index), walk, components),
      );
    }
    case 'dynamiczone': {
      if (!Array.isArray(value)) {
        return issue(walk, path, 'INVALID_TYPE', 'must be a list');
      }
      checkCount(walk, path, value.length, field.settings);
      return value.map((item, index) => {
        const at = pointer(path, index);
        const componentId = isRecord(item) ? item[COMPONENT_KEY] : undefined;
        const component =
          typeof componentId === 'string' && field.settings.components.includes(componentId)
            ? components.get(componentId)
            : undefined;
        if (!component) {
          return issue(walk, pointer(at, COMPONENT_KEY), 'UNKNOWN_COMPONENT', 'is not allowed in this zone');
        }
        const fields = checkComponentObject(component, item, at, walk, components);
        return fields ? { [COMPONENT_KEY]: component.id, ...fields } : undefined;
      });
    }
    case 'relation': {
      const ids = checkReferences(walk, path, value, field.settings.cardinality === 'many');
      if (!ids) {
        return undefined;
      }
      if (field.settings.cardinality === 'many') {
        checkCount(walk, path, ids.length, field.settings);
      }
      const target = field.settings.target;
      walk.relations.push({
        path,
        fieldId: field.id,
        targetModelId: target,
        targetModelIds: acceptedModelIds(walk.families.get(target)?.target, target),
        ...(walk.families.get(target)?.accepts ? { accepts: walk.families.get(target)?.accepts } : {}),
        entryIds: ids,
      });
      return value;
    }
    case 'media': {
      const ids = checkReferences(walk, path, value, field.settings.multiple);
      if (!ids) {
        return undefined;
      }
      if (field.settings.multiple) {
        checkCount(walk, path, ids.length, field.settings);
      }
      walk.media.push({ path, assetIds: ids, allowedKinds: field.settings.allowedKinds ?? null });
      return value;
    }
    case 'richtext': {
      const result = validateRichText(value);
      if (!result.ok) {
        walk.issues.push(
          ...result.problems.map((problem) => ({
            path: `${path}${problem.path}`,
            code: 'INVALID_RICHTEXT' as const,
            message: problem.message,
          })),
        );
        return undefined;
      }
      if (isEmptyRichText(result.document)) {
        // An empty editor is a missing value.
        return field.required && !walk.options.skipRequired
          ? issue(walk, path, 'REQUIRED', 'is required')
          : undefined;
      }
      const images = richTextMediaIds(result.document);
      if (images.length > 0) {
        walk.media.push({ path, assetIds: images, allowedKinds: ['image'] });
      }
      if (field.settings.maxLength !== undefined && result.textLength > field.settings.maxLength) {
        return issue(
          walk,
          path,
          'TOO_LONG',
          `must be at most ${field.settings.maxLength} characters of text`,
        );
      }
      return result.document;
    }
    case 'json':
      return value;
    case 'code':
      return checkCode(field, value, path, walk);
    default:
      return issue(walk, path, 'INVALID_TYPE', `unsupported type ${field.type}`);
  }
};

function checkField(
  field: FieldDefinition,
  value: unknown,
  path: string,
  walk: Walk,
  components: Components,
): unknown {
  if (isMissingValue(value)) {
    if (field.required && !walk.options.skipRequired) {
      issue(walk, path, 'REQUIRED', 'is required');
    }
    return undefined;
  }
  if (SCALAR_DATA_TYPES.has(field.type) || (field.type === 'enum' && field.settings.multiple)) {
    const outcome = checkScalar(field, value);
    return outcome.ok ? outcome.value : issue(walk, path, outcome.code, outcome.message);
  }
  return checkStructured(field, value, path, walk, components);
}

/** API keys → field IDs, recursively through components and dynamic zones. */
const mapInput = (
  definition: SchemaDefinition,
  input: Readonly<Record<string, unknown>>,
  path: string,
  issues: ContentIssue[],
  components: Components,
): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === COMPONENT_KEY && isComponentDefinition(definition)) {
      continue;
    }
    const field = findFieldByApiKey(definition.fields, key);
    if (!field) {
      issues.push({
        path: pointer(path, key),
        code: 'UNKNOWN_FIELD',
        message: 'is not a field of this model',
      });
      continue;
    }
    output[field.id] = mapFieldInput(field, value, pointer(path, key), issues, components);
  }
  return output;
};

const mapComponentInput = (
  component: ComponentDefinition | undefined,
  value: unknown,
  path: string,
  issues: ContentIssue[],
  components: Components,
) => (component && isRecord(value) ? mapInput(component, value, path, issues, components) : value);

function mapFieldInput(
  field: FieldDefinition,
  value: unknown,
  path: string,
  issues: ContentIssue[],
  components: Components,
): unknown {
  if (field.type === 'component') {
    const component = components.get(field.settings.component);
    return field.settings.repeatable && Array.isArray(value)
      ? value.map((item, index) =>
          mapComponentInput(component, item, pointer(path, index), issues, components),
        )
      : mapComponentInput(component, value, path, issues, components);
  }
  if (field.type === 'dynamiczone' && Array.isArray(value)) {
    return value.map((item, index) => {
      const at = pointer(path, index);
      const apiKey = isRecord(item) ? item[COMPONENT_KEY] : undefined;
      const component = field.settings.components
        .map((id) => components.get(id))
        .find((candidate) => candidate?.apiKey === apiKey);
      if (!component) {
        issues.push({
          path: pointer(at, COMPONENT_KEY),
          code: 'UNKNOWN_COMPONENT',
          message: 'is not allowed in this zone',
        });
        return item as unknown;
      }
      return {
        [COMPONENT_KEY]: component.id,
        ...mapInput(component, item as Record<string, unknown>, at, issues, components),
      };
    });
  }
  return value;
}

const compile = (model: ContentModel, families: TargetFamilies): ModelValidator => {
  const components: Components = new Map(
    [...model.components].map(([id, entry]) => [id, entry.definition] as const),
  );
  return {
    model,
    fromInput: (input) => {
      const issues: ContentIssue[] = [];
      return { patch: mapInput(model.definition, input, '', issues, components), issues };
    },
    validate: (data, options = {}) => {
      const walk: Walk = { data: {}, issues: [], relations: [], media: [], options, families };
      walk.data = validateFields(model.definition, data, '', walk, components);
      return { data: walk.data, issues: walk.issues, relations: walk.relations, media: walk.media };
    },
  };
};

const MAX_CACHED_VALIDATORS = 500;
const cache = new Map<string, ModelValidator>();

/** Every model the model's relation fields (its own and its components') may point at. */
const relationTargetsOf = (model: ContentModel): string[] => {
  const fields = [
    ...model.definition.fields,
    ...[...model.components.values()].flatMap((component) => component.definition.fields),
  ];
  return [
    ...new Set(fields.flatMap((field) => (field.type === 'relation' ? [field.settings.target] : []))),
  ].sort();
};

/**
 * What each relation target accepts at the snapshot: a model's kinds, an interface's members (plan
 * interfaces), or any entry.
 */
const targetFamiliesOf = (snapshot: SchemaById, model: ContentModel): TargetFamilies =>
  new Map(
    relationTargetsOf(model).map((stored) => {
      const target = relationTargetFor(snapshot, stored);
      const accepts = acceptsInWords(snapshot, target);
      return [stored, accepts ? { target, accepts } : { target }] as const;
    }),
  );

/** "a, b, or c" (the serial comma), "a or b", "a". */
const orList = (items: readonly string[]): string =>
  items.length <= 2 ? items.join(' or ') : `${items.slice(0, -1).join(', ')}, or ${items.at(-1) ?? ''}`;

/** What an interface or any-entry relation accepts, in words; undefined for a model target. */
const acceptsInWords = (snapshot: SchemaById, target: RelationTarget): string | undefined => {
  if (target.kind === 'any') {
    return 'an entry of this site';
  }
  if (target.kind === 'model') {
    return undefined;
  }
  const label = snapshot.byId.get(target.id)?.definition.label ?? 'member of this interface';
  const members = target.modelIds.flatMap((id) => {
    const memberLabel = snapshot.byId.get(id)?.definition.label;
    return memberLabel ? [memberLabel] : [];
  });
  return members.length > 0 ? `a ${label} (a ${orList(members)})` : `a ${label} (no type implements it)`;
};

/**
 * The cache key: the model's revision, every ancestor's (in chain order: a parent edit changes the effective
 * fields), every embedded component's, and what every relation target accepts (a new kind of a target, or a
 * type joining an interface, widens it; any entry is a constant).
 */
const cacheKey = (snapshot: SchemaById, model: ContentModel, families: TargetFamilies) =>
  [
    model.revisionId,
    ...[...model.ancestors.values()].map((ancestor) => ancestor.revisionId),
    '',
    ...[...model.components.keys()].sort().map((id) => snapshot.byId.get(id)?.revisionId ?? id),
    '',
    ...[...families.values()].map(({ target }) => relationTargetKey(target)),
    // An interface's refusal names it and its members by label: a rename of any of them is a new revision.
    ...[...families.values()].flatMap(({ target }) =>
      target.kind === 'interface'
        ? [target.id, ...target.modelIds].map((id) => snapshot.byId.get(id)?.revisionId ?? id)
        : [],
    ),
  ].join(':');

/** The compiled validator for a model at the pinned snapshot, cached by schema revision IDs. */
export const buildValidator = (snapshot: SchemaById, model: ContentModel): ModelValidator => {
  const families = targetFamiliesOf(snapshot, model);
  const key = cacheKey(snapshot, model, families);
  let validator = cache.get(key);
  if (!validator) {
    if (cache.size >= MAX_CACHED_VALIDATORS) {
      cache.clear();
    }
    validator = compile(model, families);
    cache.set(key, validator);
  }
  return validator;
};
