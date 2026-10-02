import { isDeepStrictEqual } from 'node:util';
import type { SchemaChange } from '@shapio/schema';
import type { ContentData } from '../../db/contentData.js';
import type { ScannedHead } from '../../repositories/entryHeads.js';
import { stepKey, type ContentStep } from '../../schema/planner/steps.js';
import { isMissingValue } from '../validator/index.js';
import { convertValue, isEntryLevelConversion } from './convert.js';
import { ownerContainers } from './paths.js';

/**
 * What a schema change would store for one entry, computed in memory (ADR 0002 pipeline). Conversions and
 * backfills are applied here, checked against the proposed schema, and written to storage only inside the
 * activation transaction, so a change that fails leaves stored content untouched.
 */
export type TransformStep = Extract<ContentStep, { kind: 'convert' | 'backfill' }>;

export const isTransformStep = (step: ContentStep): step is TransformStep =>
  step.kind === 'convert' || step.kind === 'backfill';

/** The fields of a head the entry-level conversions read (stored heads and proposed ones alike). */
export type HeadLike = Pick<ScannedHead, 'locale' | 'state' | 'revision_id' | 'data' | 'autosaved_at'>;

export type ProposedHead = ScannedHead & {
  /** The data (or, for a head the conversion publishes, the head itself) differs from what is stored. */
  changed: boolean;
};

export type EntryProposal = {
  entryId: string;
  heads: ProposedHead[];
  /** Stored heads the conversion removes (another locale's, when a model stops being localized). */
  removed: ScannedHead[];
  /** Keys of convert steps with no converter for one of the entry's values. */
  failedSteps: Map<string, number>;
};

/** Drafts saved without full validation (autosave, duplicate) need not satisfy `required` yet. */
export const isLenientDraft = (head: Pick<HeadLike, 'state' | 'autosaved_at'>) =>
  head.state === 'draft' && head.autosaved_at !== null;

export const draftsOf = <T extends HeadLike>(heads: readonly T[]): T[] =>
  heads.filter((head) => head.state === 'draft').sort((a, b) => a.locale.localeCompare(b.locale));

/** The locale whose values win: the default locale when the entry has it, else the first by code. */
export const primaryLocale = (heads: readonly HeadLike[], defaultLocale: string): string | undefined =>
  draftsOf(heads).find((head) => head.locale === defaultLocale)?.locale ?? draftsOf(heads)[0]?.locale;

/** A draft's data once a field becomes shared: the primary draft's value, or undefined when unchanged. */
export const unifiedData = (
  draft: HeadLike,
  primary: HeadLike | undefined,
  fieldId: string,
): ContentData | undefined => {
  if (!primary || draft === primary || isDeepStrictEqual(draft.data[fieldId], primary.data[fieldId])) {
    return undefined;
  }
  const data = { ...draft.data };
  if (primary.data[fieldId] === undefined) {
    delete data[fieldId];
  } else {
    data[fieldId] = primary.data[fieldId];
  }
  return data;
};

/** Drafts that differ from what is live in their locale: a model that stops having drafts publishes them. */
export const unpublishedDrafts = <T extends HeadLike>(heads: readonly T[]): T[] =>
  draftsOf(heads).filter((draft) => {
    const published = heads.find((head) => head.state === 'published' && head.locale === draft.locale);
    return !published || published.revision_id !== draft.revision_id || draft.autosaved_at !== null;
  });

const unifyField = (heads: ScannedHead[], fieldId: string, defaultLocale: string): ScannedHead[] => {
  const primary = draftsOf(heads).find((head) => head.locale === primaryLocale(heads, defaultLocale));
  return heads.map((head) => {
    const data = head.state === 'draft' ? unifiedData(head, primary, fieldId) : undefined;
    return data ? { ...head, data: structuredClone(data) } : head;
  });
};

const keepOneLocale = (heads: ScannedHead[], defaultLocale: string): ScannedHead[] => {
  const keep = primaryLocale(heads, defaultLocale);
  return heads.filter((head) => head.locale === keep);
};

const publishAll = (heads: ScannedHead[]): ScannedHead[] => {
  const pending = unpublishedDrafts(heads);
  if (pending.length === 0) {
    return heads;
  }
  const published = pending.map((draft) => ({
    ...draft,
    state: 'published',
    autosaved_at: null,
    data: structuredClone(draft.data),
  }));
  return [
    ...heads
      .filter(
        (head) => !(head.state === 'published' && pending.some((draft) => draft.locale === head.locale)),
      )
      .map((head) => (pending.includes(head) ? { ...head, autosaved_at: null } : head)),
    ...published,
  ];
};

const convertEntryHeads = (heads: ScannedHead[], change: SchemaChange, defaultLocale: string) => {
  if (change.kind === 'field.localized' && change.to === false && change.fieldId) {
    return unifyField(heads, change.fieldId, defaultLocale);
  }
  if (change.kind === 'model.localized' && change.to === false) {
    return keepOneLocale(heads, defaultLocale);
  }
  if (change.kind === 'model.draftAndPublish' && change.to === false) {
    return publishAll(heads);
  }
  return heads;
};

const containersOf = (step: TransformStep, head: ScannedHead) =>
  step.locations
    .filter((location) => location.modelId === head.model_id)
    .flatMap((location) => ownerContainers(head.data, location.path, step.ownerId));

const backfill = (step: Extract<TransformStep, { kind: 'backfill' }>, head: ScannedHead) => {
  for (const container of containersOf(step, head)) {
    if (isMissingValue(container[step.fieldId])) {
      container[step.fieldId] = structuredClone(step.value);
    }
  }
};

/** Converts a head's values in place; returns false when a value has no converter. */
const convertValues = (step: Extract<TransformStep, { kind: 'convert' }>, head: ScannedHead): boolean => {
  const { fieldId } = step.change;
  if (!fieldId) {
    return true;
  }
  let converted = true;
  for (const container of containersOf(step, head)) {
    const value = container[fieldId];
    if (value === undefined || value === null) {
      continue;
    }
    const conversion = convertValue(step.change, value);
    if (conversion.kind === 'set') {
      container[fieldId] = conversion.value;
    } else if (conversion.kind === 'clear') {
      delete container[fieldId];
    } else if (conversion.kind === 'fail') {
      converted = false;
    }
  }
  return converted;
};

const headKey = (head: Pick<ScannedHead, 'locale' | 'state'>) => `${head.locale}|${head.state}`;

/**
 * Applies the change's conversions and backfills, in plan order, to copies of an entry's stored heads.
 * Every step is idempotent, so the result is the same whether or not storage already holds converted values.
 */
export const proposeEntry = (
  stored: readonly ScannedHead[],
  steps: readonly TransformStep[],
  defaultLocale: string,
): EntryProposal => {
  let heads: ScannedHead[] = stored.map((head) => ({ ...head, data: structuredClone(head.data) }));
  const failedSteps = new Map<string, number>();
  for (const step of steps) {
    if (step.kind === 'convert' && isEntryLevelConversion(step.change)) {
      heads = convertEntryHeads(heads, step.change, defaultLocale);
      continue;
    }
    for (const head of heads) {
      if (step.kind === 'backfill') {
        backfill(step, head);
      } else if (!convertValues(step, head)) {
        failedSteps.set(stepKey(step), (failedSteps.get(stepKey(step)) ?? 0) + 1);
      }
    }
  }
  const before = new Map(stored.map((head) => [headKey(head), head]));
  return {
    entryId: stored[0]?.entry_id ?? '',
    heads: heads.map((head) => {
      const original = before.get(headKey(head));
      const changed =
        !original ||
        original.revision_id !== head.revision_id ||
        original.autosaved_at !== head.autosaved_at ||
        !isDeepStrictEqual(original.data, head.data);
      return { ...head, changed };
    }),
    removed: stored.filter((head) => !heads.some((kept) => headKey(kept) === headKey(head))),
    failedSteps,
  };
};

/** Whether applying the proposal writes anything. */
export const proposalChangesStorage = (proposal: EntryProposal) =>
  proposal.removed.length > 0 || proposal.heads.some((head) => head.changed);
