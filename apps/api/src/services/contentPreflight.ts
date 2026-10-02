import { publishingDisabled } from '../content/errors.js';
import type { Finding, HealthRule } from '../content/health/rules.js';
import type { ContentModel } from '../content/model.js';
import { findPublishedUniqueConflicts } from '../content/unique.js';
import { buildValidator } from '../content/validator/index.js';
import type { ContentIssue } from '../content/validator/issues.js';
import { findTargetIssues } from '../content/write/references.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { HeadRecord } from '../repositories/entryHeads.js';
import { assertEntryVisible, modelWithPolicy, type ContentServiceContext } from './contentAccess.js';
import { computeEntryHealth, recordEntryHealth } from './contentHealth.js';
import { targetLocales } from './contentPublishing.js';

/**
 * The publish pre-flight (plan editor-experience §2, §9): what publishing these locales would run into,
 * without publishing. It reuses the publish path's checks (validator, relation and media targets, the
 * published unique registry) as errors, and adds the health rules as warnings. No hooks run and nothing is
 * locked, so an extension's `beforePublish` can still refuse a publish that passed. Each call also records
 * the entry's health findings, so the Inbox stays current.
 */
export type PreflightRule = HealthRule | 'invalid' | 'mediaMissing';

export type PreflightCheck = {
  rule: PreflightRule;
  severity: 'error' | 'warning';
  path?: string;
  code?: string;
  params: Record<string, string | number | null>;
};

export type PreflightResult = {
  locales: { locale: string; ready: boolean; checks: PreflightCheck[] }[];
  entry: PreflightCheck[];
};

/** Health rules that matter when publishing a locale; the others are covered by errors or are about time. */
const LOCALE_WARNINGS: ReadonlySet<HealthRule> = new Set(['altMissing', 'relationUnpublished']);

const RULE_OF_ISSUE: Partial<Record<ContentIssue['code'], PreflightRule>> = {
  REQUIRED: 'requiredEmpty',
  RELATION_TARGET_MISSING: 'relationMissing',
  MEDIA_MISSING: 'mediaMissing',
};

const issueCheck = (issue: ContentIssue): PreflightCheck => ({
  rule: RULE_OF_ISSUE[issue.code] ?? 'invalid',
  severity: 'error',
  path: issue.path,
  code: issue.code,
  params: {},
});

const findingCheck = (finding: Finding): PreflightCheck => ({
  rule: finding.rule,
  severity: finding.severity,
  ...(finding.path ? { path: finding.path } : {}),
  params: finding.params,
});

/** Errors for one locale's draft: what `publishLocalesInTransaction` would refuse. */
const localeErrors = async (
  context: ContentServiceContext,
  model: ContentModel,
  draft: HeadRecord,
): Promise<PreflightCheck[]> => {
  const outcome = buildValidator(context.snapshot, model).validate(draft.data);
  const targets = await findTargetIssues(context.db, outcome, { lock: false });
  return [...outcome.issues, ...targets].map(issueCheck);
};

const uniqueErrors = async (
  context: ContentServiceContext,
  model: ContentModel,
  entryId: string,
  drafts: readonly HeadRecord[],
) => {
  if (!model.definition.draftAndPublish) {
    return [];
  }
  const conflicts = await findPublishedUniqueConflicts(context.db, {
    entryId,
    model: model.definition,
    drafts: drafts.map((draft) => ({ locale: draft.locale, data: draft.data })),
  });
  return conflicts.map(({ locale, fieldId }) => {
    const field = model.definition.fields.find((candidate) => candidate.id === fieldId);
    const check: PreflightCheck = {
      rule: 'uniqueConflict',
      severity: 'error',
      code: 'NOT_UNIQUE',
      params: { fieldId },
      ...(field ? { path: `/${field.apiKey}` } : {}),
    };
    return { locale, check };
  });
};

export const runPreflight = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: { locales?: string[]; staleDays: number },
): Promise<PreflightResult> => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'publish');
  if (!model.definition.draftAndPublish) {
    throw publishingDisabled(modelKey);
  }
  assertEntryVisible(
    policy,
    context.actor,
    await entriesRepository.findLive(id, model.definition.id, context.db),
    id,
  );
  const heads = await entryHeadsRepository.findForEntry(id, context.db);
  const locales = targetLocales(context, model, input.locales, heads);
  const drafts = heads.filter((head) => head.state === 'draft' && locales.includes(head.locale));
  const env = { db: context.db, snapshot: context.snapshot, staleDays: input.staleDays };
  const findings = await computeEntryHealth(env, model, id, heads);
  await recordEntryHealth(env, { entryId: id, modelId: model.definition.id }, findings);
  const unique = await uniqueErrors(context, model, id, drafts);
  const result: PreflightResult['locales'] = [];
  for (const locale of locales) {
    const draft = drafts.find((head) => head.locale === locale);
    const checks: PreflightCheck[] = draft
      ? [
          ...(await localeErrors(context, model, draft)),
          ...unique.filter((item) => item.locale === locale).map((item) => item.check),
          ...findings
            .filter((finding) => finding.locale === locale && LOCALE_WARNINGS.has(finding.rule))
            .map(findingCheck),
        ]
      : [{ rule: 'localeMissing', severity: 'error', params: { locale } }];
    result.push({ locale, ready: !checks.some((check) => check.severity === 'error'), checks });
  }
  const entry = findings
    .filter((finding) => finding.rule === 'localeMissing' && !locales.includes(finding.locale))
    .map(findingCheck);
  return { locales: result, entry };
};
