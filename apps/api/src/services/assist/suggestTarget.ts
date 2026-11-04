import {
  effectiveTitleField,
  SEO_COMPONENT_ID,
  SEO_DESCRIPTION_SOFT_MAX,
  SEO_FIELD_IDS,
  SEO_TITLE_SOFT_MAX,
  type ComponentDefinition,
  type FieldDefinition,
} from '@shapio/schema';
import type { ContentModel } from '../../content/model.js';
import { isMissingValue } from '../../content/validator/index.js';
import type { ContentData } from '../../db/contentData.js';
import { AppError } from '../../helpers/appError.js';

/** Field types a suggestion can be written for (plan write-and-fill §2). */
export type SuggestibleType = 'string' | 'text' | 'enum';
const SUGGESTIBLE_TYPES: ReadonlySet<string> = new Set<SuggestibleType>(['string', 'text', 'enum']);

/**
 * The field a suggestion is for: a top-level field, or a field of a non-repeatable component field
 * (`parent`). `topField` is the field the value is stored under (the unit of the write mask).
 */
export type SuggestTarget = {
  /** The JSON pointer in API IDs, as given. */
  path: string;
  field: FieldDefinition<SuggestibleType>;
  parent?: { field: FieldDefinition<'component'>; component: ComponentDefinition };
  topField: FieldDefinition;
  isTitle: boolean;
  /** A length search results usually cut at (the built-in SEO title and description); never enforced. */
  softMaxLength?: number;
};

export const notSuggestible = (fieldPath: string, reason: string) =>
  new AppError(400, 'ASSIST_FIELD_NOT_SUGGESTIBLE', `"${fieldPath}" cannot get a suggestion: ${reason}`, {
    field: fieldPath,
  });

/** The segments of a JSON pointer (RFC 6901), or undefined when it is not one. */
const segmentsOf = (pointer: string): string[] | undefined =>
  pointer.startsWith('/')
    ? pointer
        .slice(1)
        .split('/')
        .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    : undefined;

const liveField = (fields: readonly FieldDefinition[], apiKey: string) =>
  fields.find((field) => field.apiKey === apiKey && !field.deprecated);

const asSuggestible = (fieldPath: string, field: FieldDefinition | undefined, where: string) => {
  if (!field) {
    throw notSuggestible(fieldPath, `it is not a field of ${where}`);
  }
  if (!SUGGESTIBLE_TYPES.has(field.type)) {
    throw notSuggestible(fieldPath, 'only string, text and enum fields get suggestions');
  }
  return field as FieldDefinition<SuggestibleType>;
};

const softMaxOf = (component: ComponentDefinition | undefined, field: FieldDefinition) => {
  if (component?.id !== SEO_COMPONENT_ID) {
    return undefined;
  }
  if (field.id === SEO_FIELD_IDS.title) {
    return SEO_TITLE_SOFT_MAX;
  }
  return field.id === SEO_FIELD_IDS.description ? SEO_DESCRIPTION_SOFT_MAX : undefined;
};

/**
 * Resolves `fieldPath` on the model: `/apiKey` (a live string, text or enum field, the title included) or
 * `/component/apiKey` through a live, non-repeatable component field. Anything else is
 * `400 ASSIST_FIELD_NOT_SUGGESTIBLE`.
 */
export const resolveSuggestTarget = (model: ContentModel, fieldPath: string): SuggestTarget => {
  const segments = segmentsOf(fieldPath);
  if (!segments || segments.length === 0 || segments.length > 2 || segments.some((key) => key === '')) {
    throw notSuggestible(fieldPath, 'it must name a field, or a field of a single component');
  }
  const [topKey = '', subKey] = segments;
  const top = liveField(model.definition.fields, topKey);
  if (subKey === undefined) {
    const field = asSuggestible(fieldPath, top, 'this content type');
    const title = effectiveTitleField(model.definition);
    return { path: fieldPath, field, topField: field, isTitle: title?.id === field.id };
  }
  if (!top || top.type !== 'component') {
    throw notSuggestible(fieldPath, `"${topKey}" is not a component field`);
  }
  const holder = top;
  if (holder.settings.repeatable) {
    throw notSuggestible(fieldPath, 'fields of repeatable components do not get suggestions');
  }
  const component = model.components.get(holder.settings.component)?.definition;
  if (!component) {
    throw notSuggestible(fieldPath, `"${topKey}" refers to a component that does not exist`);
  }
  const field = asSuggestible(fieldPath, liveField(component.fields, subKey), `the component "${topKey}"`);
  const softMaxLength = softMaxOf(component, field);
  return {
    path: fieldPath,
    field,
    parent: { field: holder, component },
    topField: holder,
    isTitle: false,
    ...(softMaxLength === undefined ? {} : { softMaxLength }),
  };
};

/** The target's stored value in a draft's data (keyed by field IDs). */
export const targetValue = (data: Readonly<ContentData>, target: SuggestTarget): unknown => {
  const top = data[target.topField.id];
  if (!target.parent) {
    return top;
  }
  return typeof top === 'object' && top !== null && !Array.isArray(top)
    ? (top as Record<string, unknown>)[target.field.id]
    : undefined;
};

/** Whether the target holds no value (absent, null, "" or []), as the validator's `required` reads it. */
export const isTargetEmpty = (data: Readonly<ContentData>, target: SuggestTarget): boolean =>
  isMissingValue(targetValue(data, target));
