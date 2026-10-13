import type { FieldDefinition } from '@shapio/schema';
import type { Transaction } from 'kysely';
import { assertWritable, rowWriteMask } from '../content/compiler/policy.js';
import { contentVersionConflict, entryLocaleNotFound } from '../content/errors.js';
import { familyIdsOf } from '../content/family.js';
import { modelNotFound, resolveModel, type ContentModel, type HeadState } from '../content/model.js';
import { buildValidator } from '../content/validator/index.js';
import { contentInvalid } from '../content/validator/issues.js';
import { syncEntryUniqueValues, syncHeadDerivations, type WriteContext } from '../content/write/heads.js';
import { assertTargets } from '../content/write/references.js';
import { guardModelVersions } from '../content/write/transaction.js';
import type { ContentData } from '../db/contentData.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import type { Policy } from '../permissions/types.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import * as contentHealthFindingsRepository from '../repositories/contentHealthFindings.js';
import * as contentRevisionsRepository from '../repositories/contentRevisions.js';
import * as editorPresenceRepository from '../repositories/editorPresence.js';
import * as entriesRepository from '../repositories/entries.js';
import type { EntryRow } from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { HeadRecord } from '../repositories/entryHeads.js';
import * as previewTokensRepository from '../repositories/previewTokens.js';
import * as publicationsRepository from '../repositories/publications.js';
import * as scheduledPublicationsRepository from '../repositories/scheduledPublications.js';
import * as uniqueValuesRepository from '../repositories/uniqueValues.js';
import { actorColumns } from '../schema/planner/actor.js';
import {
  assertEntryVisible,
  auditEntry,
  entryModelWithPolicy,
  modelWithCreatePolicy,
  modelWithPolicy,
  routeFieldsOf,
  writeEntryEvent,
  type ContentServiceContext,
} from './contentAccess.js';
import { viewAfterWrite, type AdminEntryView } from './contentReads.js';

/**
 * Change kind (plan polymorphic-types, D11): an entry moves to another model of its family. Values of the
 * fields the new kind lacks are dropped (history keeps them); fields the new kind adds start from their
 * defaults. Every head moves in one transaction: one new revision per distinct head revision (a draft and a
 * published head that shared one share the new one), the derivations, the unique registry, the publication
 * log (the entry leaves the old kind and enters the new one at a new snapshot), and the rows that name the
 * entry's model. Older snapshots keep serving the entry under its old kind: the log's model is historical.
 */

export type DroppedField = { id: string; apiKey: string; label: string };

export type KindTarget = { modelId: string; modelKey: string; routeKey: string };

export type ChangeKindInput = {
  targetModelKey: string;
  /** The draft version the editor saw (of `locale`'s draft). */
  expectedVersion: number;
  /** The locale the editor has open; the default locale (or the only draft) when absent. */
  locale?: string;
  /** Required on a change that drops fields. */
  acknowledgeDroppedFields?: boolean;
};

export type ChangeKindResult = {
  droppedFields: DroppedField[];
  target: KindTarget;
  /** The entry as its new kind; absent on a dry run. */
  entry?: AdminEntryView;
};

const kindChangeInvalid = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, 'INVALID_KIND_CHANGE', message, details);

const kindChangeBlocked = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, 'KIND_CHANGE_BLOCKED', message, details);

/** Fields of the source's effective fields the target does not have, by ID. */
const droppedFieldsOf = (source: ContentModel, target: ContentModel): FieldDefinition[] => {
  const kept = new Set(target.definition.fields.map((field) => field.id));
  return source.definition.fields.filter((field) => !kept.has(field.id));
};

/** Field IDs holding a value in any of the heads. */
const storedFieldIds = (heads: readonly HeadRecord[]): Set<string> =>
  new Set(heads.flatMap((head) => Object.keys(head.data)));

/** The head's data as the target kind: dropped keys removed, defaults of the target's new fields added. */
const dataForTarget = (
  data: Readonly<ContentData>,
  dropped: ReadonlySet<string>,
  source: ContentModel,
  target: ContentModel,
): ContentData => {
  const sourceFields = new Set(source.definition.fields.map((field) => field.id));
  const output: ContentData = Object.fromEntries(Object.entries(data).filter(([key]) => !dropped.has(key)));
  for (const field of target.definition.fields) {
    if (!sourceFields.has(field.id) && field.defaultValue !== undefined && !field.deprecated) {
      output[field.id] ??= field.defaultValue;
    }
  }
  return output;
};

type Plan = {
  source: ContentModel;
  sourcePolicy: Policy;
  target: ContentModel;
  targetPolicy: Policy;
  dropped: FieldDefinition[];
  kindTarget: KindTarget;
};

/** The source (the entry's own model), the target and the caller's policies; refuses what may not move. */
const planChange = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  targetModelKey: string,
): Promise<Plan> => {
  const { model: source, policy: sourcePolicy } = await entryModelWithPolicy(context, modelKey, id, 'update');
  const target = (() => {
    try {
      return resolveModel(context.snapshot, targetModelKey);
    } catch {
      throw modelNotFound(targetModelKey);
    }
  })();
  if (target.definition.id === source.definition.id) {
    throw kindChangeInvalid(`The entry already is a ${source.definition.apiKey}`);
  }
  const root = context.snapshot.rootOf(source.definition.id) ?? source.definition.id;
  if (!familyIdsOf(context.snapshot, root).includes(target.definition.id)) {
    throw kindChangeInvalid(
      `"${target.definition.apiKey}" is not a kind of the same family as "${source.definition.apiKey}"`,
      { targetModelKey },
    );
  }
  const { policy: targetPolicy } = await modelWithCreatePolicy(context, target.definition.apiKey);
  return {
    source,
    sourcePolicy,
    target,
    targetPolicy,
    dropped: droppedFieldsOf(source, target),
    kindTarget: {
      modelId: target.definition.id,
      modelKey: target.definition.apiKey,
      routeKey: routeFieldsOf(target).routeKey,
    },
  };
};

/**
 * What the caller must be allowed, on the loaded entry: every dropped field that holds a value inside its
 * write mask on the source, every kept value inside its write mask on the target, and `publish` on the
 * target when the entry has a published state.
 */
const assertMayMove = async (
  context: ContentServiceContext,
  plan: Plan,
  entry: EntryRow,
  heads: readonly HeadRecord[],
) => {
  const stored = storedFieldIds(heads);
  const droppedIds = new Set(plan.dropped.map((field) => field.id));
  assertWritable(
    rowWriteMask(plan.sourcePolicy, context.actor, entry),
    plan.source.definition.fields,
    [...stored].filter((fieldId) => droppedIds.has(fieldId)),
  );
  assertWritable(
    rowWriteMask(plan.targetPolicy, context.actor, entry),
    plan.target.definition.fields,
    [...stored].filter((fieldId) => !droppedIds.has(fieldId)),
  );
  if (heads.some((head) => head.state === 'published')) {
    await modelWithPolicy(context, plan.target.definition.apiKey, 'publish');
  }
};

/** Refuses while another process owns the entry's future: an unfinished change set or a scheduled publication. */
const assertNotPending = async (entryId: string, executor: ContentServiceContext['db'] | Transaction<DB>) => {
  const sets = await changeSetItemsRepository.findUnfinishedSetsForEntry(entryId, executor);
  if (sets.length > 0) {
    throw kindChangeBlocked(
      'The entry is in a change set that has not shipped; remove it from the set first',
      {
        changeSets: sets.map((set) => ({ id: set.id, title: set.title })),
      },
    );
  }
  if (await scheduledPublicationsRepository.hasScheduledForEntry(entryId, executor)) {
    throw kindChangeBlocked('The entry has a scheduled publication; cancel it first');
  }
};

/** The draft whose version the editor saw: the requested locale's, the default's, or the only one. */
const draftSeen = (
  context: ContentServiceContext,
  model: ContentModel,
  entryId: string,
  heads: readonly HeadRecord[],
  locale: string | undefined,
): HeadRecord => {
  const drafts = heads.filter((head) => head.state === 'draft');
  const wanted = model.definition.localized ? (locale ?? context.snapshot.defaultLocale) : drafts[0]?.locale;
  const draft = drafts.find((head) => head.locale === wanted);
  if (!draft) {
    throw entryLocaleNotFound(
      entryId,
      wanted ?? context.snapshot.defaultLocale,
      drafts.map((head) => head.locale),
    );
  }
  return draft;
};

/** Moves every head; returns the published heads' locales and revisions. */
const moveHeads = async (
  context: ContentServiceContext,
  write: WriteContext,
  plan: Plan,
  entryId: string,
  heads: readonly HeadRecord[],
): Promise<Array<{ locale: string; revisionId: string }>> => {
  const { source, target } = plan;
  const dropped = new Set(plan.dropped.map((field) => field.id));
  const validator = buildValidator(context.snapshot, target);
  const author = actorColumns(write.actor);
  // A draft and a published head that shared a revision share the new one (content/migration precedent).
  const revisions = new Map<string, string>();
  const published: Array<{ locale: string; revisionId: string }> = [];
  for (const head of heads) {
    const data = dataForTarget(head.data, dropped, source, target);
    const strict = validator.validate(data, { skipRequired: false });
    // A published head must be complete as its new kind; a draft may lack a required value the new kind adds,
    // and is then flagged for the editor to complete (as a duplicate is).
    const outcome = head.state === 'published' ? strict : validator.validate(data, { skipRequired: true });
    if (outcome.issues.length > 0) {
      throw contentInvalid(outcome.issues);
    }
    await assertTargets(write.trx, outcome, write.siteId);
    const shareKey = head.autosaved_at === null ? head.revision_id : `${head.revision_id}:${head.state}`;
    let revisionId = revisions.get(shareKey);
    if (!revisionId) {
      revisionId = (
        await contentRevisionsRepository.insert(
          {
            entryId,
            locale: head.locale,
            schemaRevisionId: target.revisionId,
            data: outcome.data,
            reason: 'conversion',
            authorType: author.type,
            authorId: author.id,
            parentRevisionId: head.revision_id,
          },
          write.trx,
        )
      ).id;
      revisions.set(shareKey, revisionId);
    }
    const state = head.state as HeadState;
    const incomplete = state === 'draft' && strict.issues.length > 0;
    await entryHeadsRepository.changeModel(
      { entryId, locale: head.locale, state },
      {
        modelId: target.definition.id,
        data: outcome.data,
        revisionId,
        autosavedAt: head.autosaved_at ?? (incomplete ? write.now : null),
        now: write.now,
      },
      write.trx,
    );
    await syncHeadDerivations(write, { entryId, locale: head.locale, state }, outcome.data);
    if (head.state === 'published') {
      published.push({ locale: head.locale, revisionId });
    }
  }
  return published;
};

/** Rows that name the entry's model follow it; the unique registry drops the dropped fields' claims. */
const moveEntryRows = async (write: WriteContext, plan: Plan, entryId: string) => {
  const { trx, now } = write;
  const modelId = plan.target.definition.id;
  await entriesRepository.changeModel(entryId, modelId, now, trx);
  for (const field of plan.dropped) {
    await uniqueValuesRepository.removeForEntryField(entryId, field.id, trx);
  }
  await uniqueValuesRepository.moveEntryToModel(entryId, modelId, trx);
  await syncEntryUniqueValues(write, entryId);
  await editorPresenceRepository.moveEntryToModel(entryId, modelId, trx);
  await previewTokensRepository.moveEntryToModel(entryId, modelId, trx);
  await contentHealthFindingsRepository.moveEntryToModel(
    entryId,
    modelId,
    plan.dropped.map((field) => field.apiKey),
    trx,
  );
};

/** The live periods of the published locales end under the old kind and start under the new one. */
const rollPublications = async (
  context: ContentServiceContext,
  write: WriteContext,
  entryId: string,
  published: ReadonlyArray<{ locale: string; revisionId: string }>,
): Promise<number | null> => {
  if (published.length === 0) {
    return null;
  }
  const seq = await publicationsRepository.nextSeq(write.trx, context.site.id, {
    source: 'kind_change',
    actor: actorColumns(context.actor),
  });
  for (const { locale, revisionId } of published) {
    await publicationsRepository.close(entryId, locale, seq, write.trx);
    await publicationsRepository.open(
      { entryId, modelId: write.model.definition.id, locale, revisionId, seq, now: write.now },
      write.trx,
    );
  }
  return seq;
};

const toDropped = (fields: readonly FieldDefinition[]): DroppedField[] =>
  fields.map((field) => ({ id: field.id, apiKey: field.apiKey, label: field.label }));

/**
 * `POST /api/admin/content/:modelKey/:id/kind`. A dry run reports the fields the change drops (the editor
 * shows them before the acknowledgement) without writing.
 */
export const changeEntryKind = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: ChangeKindInput,
  options: { dryRun: boolean },
): Promise<ChangeKindResult> => {
  const plan = await planChange(context, modelKey, id, input.targetModelKey);
  const droppedFields = toDropped(plan.dropped);
  if (options.dryRun) {
    const entry = assertEntryVisible(
      plan.sourcePolicy,
      context.actor,
      await entriesRepository.findLive(id, plan.source.definition.id, context.site.id, context.db),
      id,
    );
    await assertMayMove(context, plan, entry, await entryHeadsRepository.findForEntry(id, context.db));
    await assertNotPending(id, context.db);
    return { droppedFields, target: plan.kindTarget };
  }
  if (droppedFields.length > 0 && input.acknowledgeDroppedFields !== true) {
    throw kindChangeInvalid('This change drops fields: acknowledge it with acknowledgeDroppedFields', {
      droppedFields: droppedFields.map((field) => field.apiKey),
    });
  }
  let servedLocale: string | undefined;
  await context.db.transaction().execute(async (trx) => {
    // Both models and their ancestors, in key order (the activation lock order).
    await guardModelVersions(trx, [plan.source, plan.target], context.site.id);
    const write: WriteContext = {
      trx,
      siteId: context.site.id,
      model: plan.target,
      actor: context.actor,
      now: new Date(),
    };
    const entry = assertEntryVisible(
      plan.sourcePolicy,
      context.actor,
      await entriesRepository.lockLive(id, plan.source.definition.id, context.site.id, trx),
      id,
    );
    const heads = await entryHeadsRepository.lockForEntry(id, trx);
    const seen = draftSeen(context, plan.source, id, heads, input.locale);
    if (seen.version !== input.expectedVersion) {
      throw contentVersionConflict(input.expectedVersion, seen.version);
    }
    servedLocale = seen.locale;
    await assertNotPending(id, trx);
    await assertMayMove(context, plan, entry, heads);
    const published = await moveHeads(context, write, plan, id, heads);
    await moveEntryRows(write, plan, id);
    const seq = await rollPublications(context, write, id, published);
    const from = routeFieldsOf(plan.source);
    const moved = {
      from: plan.source.definition.apiKey,
      to: plan.target.definition.apiKey,
      fromRouteKey: from.routeKey,
      fromAncestors: from.ancestors,
      droppedFields: droppedFields.map((field) => field.apiKey),
      published: published.length > 0,
      snapshot: seq,
    };
    await writeEntryEvent(trx, context.site.id, plan.target, 'entry.kind_changed', id, moved);
    await auditEntry(trx, context, plan.target, 'content.change_kind', id, {
      ...moved,
      fromModelId: plan.source.definition.id,
    });
  });
  return {
    droppedFields,
    target: plan.kindTarget,
    entry: await viewAfterWrite(context, plan.target, plan.targetPolicy, id, servedLocale),
  };
};
