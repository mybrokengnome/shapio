import { isDeepStrictEqual } from 'node:util';
import type { Transaction } from 'kysely';
import { isFillRule, type FillRule } from '../../constants/assist.js';
import { resolveModel, type ContentModel } from '../../content/model.js';
import { buildValidator, isMissingValue } from '../../content/validator/index.js';
import { guardEntryWrite } from '../../content/write/transaction.js';
import type { ContentData } from '../../db/contentData.js';
import type { DB } from '../../db/types.js';
import { AppError } from '../../helpers/appError.js';
import type { Policy } from '../../permissions/types.js';
import * as assistRunsRepository from '../../repositories/assistRuns.js';
import * as changeSetItemsRepository from '../../repositories/changeSetItems.js';
import * as changeSetsRepository from '../../repositories/changeSets.js';
import * as jobsRepository from '../../repositories/jobs.js';
import { recordAudit } from '../audit.js';
import { addEntryItemInTransaction, auditFields, insertChangeSet } from '../changeSets.js';
import { EDITABLE_STATUSES } from '../changeSetViews.js';
import { modelWithPolicy, type ContentServiceContext } from '../contentAccess.js';
import { writeEntryUpdate, type DraftUpdateBase } from '../contentEntries.js';
import { statusOf } from '../contentReads.js';
import type { FieldProposal, FillResult } from './fillJob.js';
import type { SuggestedValue } from './suggest.js';
import { fieldLabelOf, resolveSuggestTarget, targetValue, type SuggestTarget } from './suggestTarget.js';

/** `value` as received: `assertShape` checks it is what the field stores. */
export type AcceptItem = { key: string; value: unknown };

export type AcceptResult = {
  entryId: string;
  modelKey: string;
  locale: string;
  version: number;
  changeSet:
    | { added: true; id: string }
    | { added: false; id: string | null; reason: 'unpublishedChanges' | 'neverPublished' };
};

const runNotFound = (runId: string) =>
  new AppError(404, 'ASSIST_RUN_NOT_FOUND', `No content-ops run ${runId}`, { runId });

const invalidItems = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, 'ASSIST_ACCEPT_ITEMS_INVALID', message, details);

const CHANGE_SET_TITLES: Readonly<Record<FillRule, (field: string, model: string) => string>> = {
  fieldEmpty: (field, model) => `Filled ${field}, proposed by ${model}`,
  requiredEmpty: (_, model) => `Filled required fields, proposed by ${model}`,
};

/**
 * The run's proposals for the items, all of one entry locale: the run must be a finished fill run of this site
 * that the caller started or may act on (`changes.manage`, checked by the route), its result still kept.
 */
const loadProposals = async (context: ContentServiceContext, runId: string, items: readonly AcceptItem[]) => {
  const run = await assistRunsRepository.findOnSite(context.site.id, runId, context.db);
  if (!run || run.action !== 'content_ops' || !run.rule || !isFillRule(run.rule)) {
    throw runNotFound(runId);
  }
  if (run.status !== 'succeeded') {
    throw new AppError(409, 'ASSIST_RUN_NOT_FINISHED', 'The run has not finished yet', {
      status: run.status,
    });
  }
  const job = run.job_id ? await jobsRepository.findById(run.job_id, context.db) : undefined;
  const result = job?.result as FillResult | null | undefined;
  if (!result?.proposals) {
    throw runNotFound(runId);
  }
  if (new Set(items.map((item) => item.key)).size !== items.length) {
    throw invalidItems('Each proposal can be accepted once per request');
  }
  const proposals = items.map((item) => {
    const proposal = result.proposals.find((candidate) => candidate.key === item.key);
    if (!proposal) {
      throw new AppError(404, 'ASSIST_PROPOSAL_NOT_FOUND', `The run has no proposal ${item.key}`, {
        key: item.key,
      });
    }
    return { proposal, value: item.value };
  });
  const [first] = proposals;
  if (
    !first ||
    proposals.some(
      ({ proposal }) =>
        proposal.entryId !== first.proposal.entryId || proposal.locale !== first.proposal.locale,
    )
  ) {
    throw invalidItems('Accept the proposals of one entry and locale at a time');
  }
  return { rule: run.rule, proposals, first: first.proposal };
};

/** The value in the shape the field stores: a string, or for a multiple enum a list of strings. */
const assertShape = (target: SuggestTarget, value: unknown, key: string): SuggestedValue => {
  const wantsList = target.field.type === 'enum' && target.field.settings.multiple;
  const fits = wantsList
    ? Array.isArray(value) && value.every((item) => typeof item === 'string')
    : typeof value === 'string';
  if (!fits) {
    throw invalidItems(`The value of ${key} must be ${wantsList ? 'a list of strings' : 'a string'}`, {
      key,
    });
  }
  return value as SuggestedValue;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The patch that fills the targets, from the locked draft. A target that holds another value now is
 * `409 ASSIST_FIELD_FILLED_MEANWHILE`; one that already holds the accepted value (a repeated accept) is left as
 * it is. A draft with unsaved autosaved work is refused: saving would make that work a revision.
 */
const fillPatch = (
  base: DraftUpdateBase,
  fills: readonly { target: SuggestTarget; value: SuggestedValue }[],
) => {
  if (base.previous?.autosaved_at) {
    throw new AppError(
      409,
      'ASSIST_DRAFT_HAS_UNSAVED_WORK',
      'The draft has unsaved changes; save or discard them, then accept again',
    );
  }
  const patch: ContentData = {};
  for (const { target, value } of fills) {
    const current = targetValue(base.before, target);
    if (!isMissingValue(current) && !isDeepStrictEqual(current, value)) {
      throw new AppError(409, 'ASSIST_FIELD_FILLED_MEANWHILE', `"${target.path}" was filled meanwhile`, {
        fieldPath: target.path,
      });
    }
    if (!target.parent) {
      patch[target.topField.id] = value;
    } else {
      const holder = patch[target.topField.id] ?? base.before[target.topField.id];
      patch[target.topField.id] = { ...(isRecord(holder) ? holder : {}), [target.field.id]: value };
    }
  }
  return patch;
};

/** The run's change set, locked, when it can still take items; null when there is none or it shipped. */
const lockRunChangeSet = async (
  trx: Transaction<DB>,
  context: ContentServiceContext,
  changeSetId: string | null,
): Promise<string | null> => {
  if (!changeSetId) {
    return null;
  }
  const current = await changeSetsRepository.lockOnSite(context.site.id, changeSetId, trx);
  return current && EDITABLE_STATUSES.has(current.status) ? current.id : null;
};

/** A new change set for the run (its first accept, or its set shipped or was discarded meanwhile). */
const openRunChangeSet = async (
  trx: Transaction<DB>,
  context: ContentServiceContext,
  runId: string,
  title: string,
): Promise<string> => {
  const created = await insertChangeSet(trx, context, {
    title,
    description: 'Field values proposed by assist and accepted one by one. Review them before shipping.',
    source: 'assist',
  });
  await assistRunsRepository.update(runId, { change_set_id: created.id }, trx);
  return created.id;
};

type Prepared = {
  runId: string;
  rule: FillRule;
  model: ContentModel;
  first: FieldProposal;
  fills: { target: SuggestTarget; value: SuggestedValue }[];
};

/**
 * One transaction (lock order as the ship's: run, change set, model, entry): the values are saved through
 * the explicit save path, and the entry locale goes into the run's change set when its draft equalled the
 * published version before (or the set already holds it), so shipping never publishes more than the fill.
 */
const acceptInTransaction = (context: ContentServiceContext, prepared: Prepared, policy: Policy) =>
  context.db.transaction().execute(async (trx): Promise<AcceptResult> => {
    const { model, first } = prepared;
    const run = await assistRunsRepository.lockOnSite(context.site.id, prepared.runId, trx);
    if (!run) {
      throw runNotFound(prepared.runId);
    }
    const setId = await lockRunChangeSet(trx, context, run.change_set_id);
    await guardEntryWrite(trx, model, context.site.id, [first.locale]);
    let publishedBefore = false;
    let neverPublished = true;
    const written = await writeEntryUpdate(trx, context, {
      model,
      policy,
      validator: buildValidator(context.snapshot, model),
      id: first.entryId,
      locale: first.locale,
      autosave: false,
      patch: (base) => {
        const published = base.heads.find(
          (head) => head.state === 'published' && head.locale === (base.previous?.locale ?? first.locale),
        );
        neverPublished = published === undefined;
        publishedBefore = base.previous !== undefined && statusOf(base.previous, published) === 'published';
        return fillPatch(base, prepared.fills);
      },
    });
    const inSet =
      setId !== null &&
      (await changeSetItemsRepository.hasEntryItem(setId, first.entryId, written.locale, trx));
    let changeSet: AcceptResult['changeSet'];
    if (inSet && setId) {
      changeSet = { added: true, id: setId };
    } else if (publishedBefore) {
      const target = prepared.fills[0]?.target;
      const fieldLabel = target ? fieldLabelOf(target) : '';
      const id =
        setId ??
        (await openRunChangeSet(
          trx,
          context,
          run.id,
          CHANGE_SET_TITLES[prepared.rule](fieldLabel, run.model),
        ));
      await addEntryItemInTransaction(trx, context, id, {
        entryId: first.entryId,
        model,
        locale: written.locale,
        action: 'publish',
      });
      changeSet = { added: true, id };
    } else {
      changeSet = {
        added: false,
        id: setId,
        reason: neverPublished ? 'neverPublished' : 'unpublishedChanges',
      };
    }
    await recordAudit(trx, {
      ...auditFields(context),
      action: 'assist.content_ops_accept',
      target: { type: 'entry', id: first.entryId },
      outcome: 'success',
      metadata: {
        runId: run.id,
        rule: prepared.rule,
        modelKey: model.definition.apiKey,
        locale: written.locale,
        fields: prepared.fills.map((fill) => fill.target.path),
        changeSetId: changeSet.id,
        addedToChangeSet: changeSet.added,
      },
    });
    return {
      entryId: first.entryId,
      modelKey: model.definition.apiKey,
      locale: written.locale,
      version: written.head?.version ?? first.entryVersion,
      changeSet,
    };
  });

/**
 * Accepts proposals of a fill run, all of one entry locale (plan write-and-fill §3): the (possibly edited)
 * values are saved into the entry's draft and the entry locale is added to the run's change set when that
 * publishes nothing but the fill. A repeated accept answers as the first did.
 */
export const acceptFillProposals = async (
  context: ContentServiceContext,
  runId: string,
  items: readonly AcceptItem[],
): Promise<AcceptResult> => {
  const { rule, proposals, first } = await loadProposals(context, runId, items);
  const model = resolveModel(context.snapshot, first.modelKey);
  const { policy } = await modelWithPolicy(context, first.modelKey, 'update');
  const fills = proposals.map(({ proposal, value }) => {
    const target = resolveSuggestTarget(model, proposal.fieldPath);
    return { target, value: assertShape(target, value, proposal.key) };
  });
  return acceptInTransaction(context, { runId, rule, model, first, fills }, policy);
};
