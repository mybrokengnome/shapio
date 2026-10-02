import type { ContentData } from '../../db/contentData.js';
import type { ContentModel } from '../model.js';
import type { ContentIssue } from '../validator/issues.js';
import { imageUsesOf } from './imageUses.js';

/**
 * The content health rules (plan editor-experience §5, §9), as pure functions of what the service loaded.
 * Every finding is advisory (`warning`); the publish pre-flight adds its own errors on top.
 */
export const HEALTH_RULES = [
  'requiredEmpty',
  'altMissing',
  'localeMissing',
  'relationMissing',
  'relationUnpublished',
  'uniqueConflict',
  'staleDraft',
  'unpublishedChanges',
] as const;
export type HealthRule = (typeof HEALTH_RULES)[number];

/** `*` marks a finding about the entry as a whole. */
export const ENTRY_LOCALE = '*';

export type FindingParams = Record<string, string | number | null>;

export type Finding = {
  locale: string;
  rule: HealthRule;
  /** Tells several findings of one rule on one entry and locale apart ('' when there is one). */
  subject: string;
  severity: 'warning';
  /** JSON pointer in API keys of the value to fix. */
  path?: string;
  params: FindingParams;
};

export type HeadSnapshot = {
  locale: string;
  data: Readonly<ContentData>;
  revisionId: string;
  updatedAt: Date;
  autosavedAt: Date | null;
};

export type AssetInfo = { alt: string; mimeType: string };

/** A relation edge of a draft head and what is known about its target. */
export type EdgeInfo = {
  locale: string;
  fieldId: string;
  targetEntryId: string;
  /** Undefined when the target entry no longer exists (or is deleted). */
  target?: {
    modelId: string;
    /** Locales with a published head. */
    publishedLocales: readonly string[];
    /** The target's model has no draft/publish split (everything saved is live) or is not localized. */
    alwaysLive: boolean;
    localized: boolean;
  };
};

export type HealthInputs = {
  model: ContentModel;
  /** Codes of every configured locale. */
  locales: readonly string[];
  drafts: readonly HeadSnapshot[];
  published: readonly HeadSnapshot[];
  /** The validator's issues for each draft, `required` included. */
  issuesByLocale: ReadonlyMap<string, readonly ContentIssue[]>;
  assets: ReadonlyMap<string, AssetInfo>;
  edges: readonly EdgeInfo[];
  /** Unique values of a draft already held by another entry's published version. */
  uniqueConflicts: readonly { locale: string; fieldId: string }[];
  now: Date;
  staleDays: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const fieldPath = (model: ContentModel, fieldId: string) => {
  const field = model.definition.fields.find((candidate) => candidate.id === fieldId);
  return field ? `/${field.apiKey}` : undefined;
};

const warning = (finding: Omit<Finding, 'severity'>): Finding => ({ ...finding, severity: 'warning' });

const requiredEmpty = (inputs: HealthInputs): Finding[] =>
  inputs.drafts.flatMap((draft) =>
    (inputs.issuesByLocale.get(draft.locale) ?? [])
      .filter((issue) => issue.code === 'REQUIRED')
      .map((issue) =>
        warning({
          locale: draft.locale,
          rule: 'requiredEmpty',
          subject: issue.path,
          path: issue.path,
          params: {},
        }),
      ),
  );

/** Images whose use and library entry both lack alt text. Non-image assets need none. */
const altMissing = (inputs: HealthInputs): Finding[] =>
  inputs.drafts.flatMap((draft) =>
    imageUsesOf(inputs.model, draft.data)
      .filter((use) => {
        const asset = inputs.assets.get(use.assetId);
        return (
          asset !== undefined &&
          asset.mimeType.startsWith('image/') &&
          use.alt === null &&
          asset.alt.trim() === ''
        );
      })
      .map((use) =>
        warning({
          locale: draft.locale,
          rule: 'altMissing',
          subject: `${use.path}#${use.assetId}#${use.occurrence}`,
          path: use.path,
          params: { assetId: use.assetId, occurrence: use.occurrence },
        }),
      ),
  );

/** Localized models: every configured locale should have a version of the entry. */
const localeMissing = (inputs: HealthInputs): Finding[] => {
  if (!inputs.model.definition.localized) {
    return [];
  }
  const present = new Set(inputs.drafts.map((draft) => draft.locale));
  return inputs.locales
    .filter((locale) => !present.has(locale))
    .map((locale) => warning({ locale, rule: 'localeMissing', subject: '', params: { locale } }));
};

const edgeFinding = (inputs: HealthInputs, edge: EdgeInfo, rule: HealthRule) => {
  const path = fieldPath(inputs.model, edge.fieldId);
  return warning({
    locale: edge.locale,
    rule,
    subject: `${edge.fieldId}:${edge.targetEntryId}`,
    ...(path ? { path } : {}),
    params: { targetEntryId: edge.targetEntryId, targetModelId: edge.target?.modelId ?? null },
  });
};

const relationMissing = (inputs: HealthInputs): Finding[] =>
  inputs.edges
    .filter((edge) => edge.target === undefined)
    .map((edge) => edgeFinding(inputs, edge, 'relationMissing'));

/** Links that delivery would drop: the target has no published version in the link's locale. */
const relationUnpublished = (inputs: HealthInputs): Finding[] =>
  inputs.edges
    .filter(({ target, locale }) => {
      if (!target || target.alwaysLive) {
        return false;
      }
      return target.localized
        ? !target.publishedLocales.includes(locale)
        : target.publishedLocales.length === 0;
    })
    .map((edge) => edgeFinding(inputs, edge, 'relationUnpublished'));

const uniqueConflict = (inputs: HealthInputs): Finding[] =>
  inputs.uniqueConflicts.map(({ locale, fieldId }) => {
    const path = fieldPath(inputs.model, fieldId);
    return warning({
      locale,
      rule: 'uniqueConflict',
      subject: fieldId,
      ...(path ? { path } : {}),
      params: { fieldId },
    });
  });

const lastEdit = (head: HeadSnapshot) => Math.max(head.updatedAt.getTime(), head.autosavedAt?.getTime() ?? 0);

/** Drafts never published and untouched for `staleDays`, and published entries with changes that old. */
const staleness = (inputs: HealthInputs): Finding[] => {
  const cutoff = inputs.now.getTime() - inputs.staleDays * DAY_MS;
  return inputs.drafts.flatMap((draft) => {
    if (lastEdit(draft) > cutoff) {
      return [];
    }
    const published = inputs.published.find((head) => head.locale === draft.locale);
    const days = Math.floor((inputs.now.getTime() - lastEdit(draft)) / DAY_MS);
    if (!published) {
      return [warning({ locale: draft.locale, rule: 'staleDraft', subject: '', params: { days } })];
    }
    const changed = published.revisionId !== draft.revisionId || draft.autosavedAt !== null;
    return changed
      ? [warning({ locale: draft.locale, rule: 'unpublishedChanges', subject: '', params: { days } })]
      : [];
  });
};

/** Every finding for one entry. Publishing rules apply only to models with drafts. */
export const evaluateHealth = (inputs: HealthInputs): Finding[] => {
  const publishing = inputs.model.definition.draftAndPublish;
  return [
    ...requiredEmpty(inputs),
    ...altMissing(inputs),
    ...localeMissing(inputs),
    ...relationMissing(inputs),
    ...(publishing ? relationUnpublished(inputs) : []),
    ...(publishing ? uniqueConflict(inputs) : []),
    ...(publishing ? staleness(inputs) : []),
  ];
};
