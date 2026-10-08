import {
  effectiveTitleField,
  isComponentDefinition,
  isStableId,
  richTextPlainText,
  type ComponentDefinition,
  type FieldDefinition,
} from '@shapio/schema';
import { maskAllows } from '../content/compiler/policy.js';
import { COMPONENT_KEY } from '../content/validator/index.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import { titleOf } from './changeSetViews.js';
import type { ContentServiceContext } from './contentAccess.js';

/**
 * Readable one-line summaries of stored field values for the change set review (rich text as its text, media
 * as file names, relations as titles, components and zones as labelled outlines), so the admin never shows
 * raw JSON for structured values. Values are in storage form (keyed by field IDs; zone items carry the
 * component ID in `__component`). A value whose shape does not match its field (a `before` value the set
 * converts on ship) falls back to compact JSON rather than failing the review.
 */
export type FieldSummary = { before: string | null; after: string | null };

export type SummaryLookups = {
  component: (id: string) => ComponentDefinition | undefined;
  /** The asset's original file name; undefined when missing or not visible to the reviewer. */
  mediaName: (id: string) => string | undefined;
  /** The related entry's title; undefined when missing or not readable by the reviewer. */
  entryTitle: (id: string) => string | undefined;
};

export const MAX_SUMMARY = 160;

const CODE_LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  plain: 'Plain text',
  html: 'HTML',
  css: 'CSS',
  javascript: 'JavaScript',
  json: 'JSON',
  yaml: 'YAML',
  markdown: 'Markdown',
};

/** Item summaries use the same textual types as the admin's collapsed items (fields/helpers/summary.ts). */
const TEXTUAL_TYPES: ReadonlySet<string> = new Set(['string', 'text', 'slug', 'email', 'url', 'uid', 'enum']);

const truncate = (text: string) => (text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1)}…` : text);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEmpty = (value: unknown) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (isRecord(value) && Object.keys(value).length === 0);

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const rawText = (value: unknown) => truncate(typeof value === 'string' ? value : JSON.stringify(value));

/** A component item's label: its title field's value, else the first non-empty text field (as the admin). */
export const summarizeItem = (
  component: ComponentDefinition,
  item: unknown,
  lookups: SummaryLookups,
): string => {
  if (!isRecord(item)) {
    return '';
  }
  const titleField = component.fields.find((field) => field.id === component.display.titleFieldId);
  const candidates = titleField ? [titleField, ...component.fields] : component.fields;
  for (const field of candidates) {
    if (TEXTUAL_TYPES.has(field.type) || field.type === 'richtext') {
      const summary = summarizeValue(field, item[field.id], lookups);
      if (summary) {
        return summary;
      }
    }
  }
  return '';
};

const labelled = (label: string, summary: string) => (summary ? `${label} (${summary})` : label);

const componentSummary = (
  field: Extract<FieldDefinition, { type: 'component' }>,
  value: unknown,
  lookups: SummaryLookups,
) => {
  const component = lookups.component(field.settings.component);
  const items = listOf(value);
  if (!component || !items.every(isRecord)) {
    return undefined;
  }
  const summaries = items.map((item) => summarizeItem(component, item, lookups)).filter(Boolean);
  if (!field.settings.repeatable) {
    return summaries[0] ? `${component.label}: ${summaries[0]}` : component.label;
  }
  const head = `${plural(items.length, 'item', 'items')} (${component.label})`;
  return summaries.length > 0 ? `${head}: ${summaries.join(', ')}` : head;
};

const zoneSummary = (value: unknown, lookups: SummaryLookups) => {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    return undefined;
  }
  const blocks = value.map((item) => {
    const id = item[COMPONENT_KEY];
    const component = typeof id === 'string' ? lookups.component(id) : undefined;
    return component ? labelled(component.label, summarizeItem(component, item, lookups)) : String(id);
  });
  return `${plural(value.length, 'block', 'blocks')}: ${blocks.join(', ')}`;
};

const referenceSummary = (value: unknown, resolve: (id: string) => string | undefined) => {
  const ids = listOf(value);
  return ids.every((id) => typeof id === 'string')
    ? ids.map((id) => resolve(id) ?? id).join(', ')
    : undefined;
};

const structuredSummary = (field: FieldDefinition, value: unknown, lookups: SummaryLookups) => {
  switch (field.type) {
    case 'richtext':
      return isRecord(value) ? richTextPlainText(value) || undefined : undefined;
    case 'media':
      return referenceSummary(value, lookups.mediaName);
    case 'relation':
      return referenceSummary(value, lookups.entryTitle);
    case 'component':
      return componentSummary(field, value, lookups);
    case 'dynamiczone':
      return zoneSummary(value, lookups);
    case 'code':
      return typeof value === 'string'
        ? `${CODE_LANGUAGE_LABELS[field.settings.language] ?? field.settings.language}, ${plural(value.split('\n').length, 'line', 'lines')}`
        : undefined;
    case 'json':
      return JSON.stringify(value);
    case 'enum': {
      const values = listOf(value);
      return values.every((item) => typeof item === 'string')
        ? values
            .map((item) => field.settings.values.find((option) => option.value === item)?.label ?? item)
            .join(', ')
        : undefined;
    }
    case 'boolean':
      return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : undefined;
    default:
      return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  }
};

/** The value as one line of at most MAX_SUMMARY characters; null when empty. */
export const summarizeValue = (
  field: FieldDefinition,
  value: unknown,
  lookups: SummaryLookups,
): string | null => {
  if (isEmpty(value)) {
    return null;
  }
  const summary = structuredSummary(field, value, lookups);
  return summary === undefined ? rawText(value) : truncate(summary);
};

/** Media and related entry IDs a value refers to directly (top-level media and relation fields). */
const referencesOf = (field: FieldDefinition, value: unknown): string[] =>
  (field.type === 'media' || field.type === 'relation') && !isEmpty(value)
    ? listOf(value).filter((id): id is string => isStableId(id))
    : [];

export type SummarizedValues = { field: FieldDefinition; values: unknown[] };

const componentLookup = (snapshots: readonly SchemaSnapshot[]) => (id: string) => {
  for (const snapshot of snapshots) {
    const definition = snapshot.byId.get(id)?.definition;
    if (definition && isComponentDefinition(definition)) {
      return definition;
    }
  }
  return undefined;
};

/** Original file names of the referenced assets on the site, when the reviewer may browse media. */
const loadMediaNames = async (context: ContentServiceContext, ids: readonly string[]) => {
  if (ids.length === 0 || !(await context.permissions.canPerform(context.actor, 'media.read'))) {
    return new Map<string, string>();
  }
  const rows = await mediaAssetsRepository.findNamesOnSite(context.site.id, ids, context.db);
  return new Map(rows.map((row) => [row.id, row.original_filename]));
};

/** Target models whose entries' titles the reviewer may read (the model and its title field). */
const readableTargets = async (
  context: ContentServiceContext,
  snapshot: SchemaSnapshot,
  modelIds: ReadonlySet<string>,
) => {
  const readable: string[] = [];
  for (const modelId of modelIds) {
    const definition = snapshot.byId.get(modelId)?.definition;
    const titleField = definition ? effectiveTitleField(definition) : undefined;
    if (!titleField) {
      continue;
    }
    const policy = await context.permissions.evaluate(context.actor, { action: 'read', modelId });
    if (policy.allowed && maskAllows(policy.readMask, titleField)) {
      readable.push(modelId);
    }
  }
  return readable;
};

/**
 * Loads what the summaries refer to, in one query each: asset names (site-scoped, `media.read`) and the titles
 * of related entries (site-scoped, only for target models whose title field the reviewer may read). Returns
 * lookups for one locale (a related entry's title in the item's locale, else another).
 */
export const loadSummaryLookups = async (
  context: ContentServiceContext,
  snapshots: readonly [SchemaSnapshot, ...SchemaSnapshot[]],
  fields: readonly SummarizedValues[],
): Promise<(locale: string) => SummaryLookups> => {
  const mediaIds = new Set<string>();
  const entryIds = new Set<string>();
  const targetModels = new Set<string>();
  for (const { field, values } of fields) {
    const ids = values.flatMap((value) => referencesOf(field, value));
    if (field.type === 'media') {
      ids.forEach((id) => mediaIds.add(id));
    } else if (field.type === 'relation' && ids.length > 0) {
      ids.forEach((id) => entryIds.add(id));
      targetModels.add(field.settings.target);
    }
  }
  const [snapshot] = snapshots;
  const [mediaNames, heads] = await Promise.all([
    loadMediaNames(context, [...mediaIds]),
    entryIds.size === 0
      ? Promise.resolve([])
      : readableTargets(context, snapshot, targetModels).then((models) =>
          entryHeadsRepository.findForEntriesOnSite(context.site.id, models, [...entryIds], context.db),
        ),
  ]);
  const component = componentLookup(snapshots);
  return (locale) => ({
    component,
    mediaName: (id) => mediaNames.get(id),
    entryTitle: (id) => {
      const own = heads.filter((head) => head.entry_id === id);
      return own[0] ? (titleOf(snapshot, own[0].model_id, own, locale) ?? undefined) : undefined;
    },
  });
};
