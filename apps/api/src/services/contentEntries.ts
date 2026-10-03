import type { ModelDefinition } from '@shapio/schema';
import type { Transaction } from 'kysely';
import { assertWritable } from '../content/compiler/policy.js';
import {
  contentVersionConflict,
  entryLocaleNotFound,
  entryReferenced,
  revisionNotFound,
  singletonExists,
} from '../content/errors.js';
import { changedSharedFieldIds, withSharedValuesOf, writeLocaleFor } from '../content/locales.js';
import type { ContentModel } from '../content/model.js';
import { uniqueFields } from '../content/unique.js';
import { buildValidator, type ModelValidator, type ValidationOutcome } from '../content/validator/index.js';
import { contentInvalid } from '../content/validator/issues.js';
import { syncEntryUniqueValues, touchEntry, writeDraft, type WriteContext } from '../content/write/heads.js';
import { assertTargets } from '../content/write/references.js';
import { runEntryWrite } from '../content/write/transaction.js';
import type { ContentData } from '../db/contentData.js';
import type { DB } from '../db/types.js';
import * as contentGuardsRepository from '../repositories/contentGuards.js';
import * as contentRevisionsRepository from '../repositories/contentRevisions.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { HeadRecord } from '../repositories/entryHeads.js';
import * as publicationsRepository from '../repositories/publications.js';
import * as relationEdgesRepository from '../repositories/relationEdges.js';
import * as uniqueValuesRepository from '../repositories/uniqueValues.js';
import { actorColumns } from '../schema/planner/actor.js';
import {
  assertEntryVisible,
  auditEntry,
  modelWithPolicy,
  writeEntryEvent,
  type ContentServiceContext,
} from './contentAccess.js';
import { publishLocalesInTransaction } from './contentPublishing.js';
import { viewAfterWrite, type AdminEntryView } from './contentReads.js';
import * as mediaReferencesService from './mediaReferences.js';

/** The publication sequence of an entry write that publishes (models without drafts publish on save). */
const publishSeqOf = (context: ContentServiceContext, trx: Transaction<DB>) =>
  publicationsRepository.createSeqAllocator(trx, context.site.id, {
    source: 'publish',
    actor: actorColumns(context.actor),
  });

/**
 * Entry writes (build plan §4.E5). Each is one transaction under the transitional write policy
 * (`runEntryWrite`): revision for explicit saves (autosave moves the draft head only), head OCC, shared
 * fields fanned out to every locale's draft (ADR 0004), relation edges and the unique registry kept in step,
 * an outbox event and the lifecycle hook points.
 */

/** Values of fields that have a default, for new entries and new localizations. */
const defaultsOf = (model: ModelDefinition, onlyLocalized = false): ContentData =>
  Object.fromEntries(
    model.fields
      .filter((field) => field.defaultValue !== undefined && !field.deprecated)
      .filter((field) => !onlyLocalized || (model.localized && field.localized))
      .map((field) => [field.id, field.defaultValue]),
  );

/** A patch over a document: null clears a field, any other value replaces it. */
const applyPatch = (base: Readonly<ContentData>, patch: Readonly<ContentData>): ContentData => {
  const output: ContentData = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete output[key];
    } else {
      output[key] = value;
    }
  }
  return output;
};

const inputPatch = (
  validator: ModelValidator,
  model: ContentModel,
  mask: Parameters<typeof assertWritable>[0],
  data: unknown,
) => {
  const { patch, issues } = validator.fromInput((data ?? {}) as Record<string, unknown>);
  if (issues.length > 0) {
    throw contentInvalid(issues);
  }
  assertWritable(mask, model.definition.fields, Object.keys(patch));
  return patch;
};

const validated = (
  validator: ModelValidator,
  data: ContentData,
  skipRequired: boolean,
): ValidationOutcome => {
  const outcome = validator.validate(data, { skipRequired });
  if (outcome.issues.length > 0) {
    throw contentInvalid(outcome.issues);
  }
  return outcome;
};

const ownerOf = (context: ContentServiceContext) => ({
  ownerAppUserId: context.actor.kind === 'appUser' ? context.actor.appUserId : null,
  createdByAdminId: context.actor.kind === 'admin' ? context.actor.adminUserId : null,
});

export type CreateEntryInput = { locale?: string; data?: unknown; publish?: boolean };

export const createEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  input: CreateEntryInput,
): Promise<AdminEntryView> => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'create');
  const publish = Boolean(input.publish) || !model.definition.draftAndPublish;
  if (input.publish && model.definition.draftAndPublish) {
    await modelWithPolicy(context, modelKey, 'publish');
  }
  const locale = writeLocaleFor(context.snapshot, model.definition, input.locale);
  const validator = buildValidator(context.snapshot, model);
  const patch = inputPatch(validator, model, policy.writeMask, input.data);
  const outcome = validated(validator, applyPatch(defaultsOf(model.definition), patch), false);
  const entryId = await runEntryWrite(context.db, model, [locale], async (trx) => {
    const write: WriteContext = { trx, model, actor: context.actor, now: new Date() };
    if (model.definition.kind === 'singleton') {
      await contentGuardsRepository.lockModelRow(model.definition.id, trx);
      if ((await entriesRepository.countLive(model.definition.id, trx)) > 0) {
        throw singletonExists(modelKey);
      }
    }
    await assertTargets(trx, outcome);
    const entry = await entriesRepository.insert(
      { siteId: context.site.id, modelId: model.definition.id, ...ownerOf(context) },
      trx,
    );
    const hook = {
      trx,
      model,
      entryId: entry.id,
      locale,
      data: outcome.data,
      actor: context.actor,
    };
    await context.hooks.run('beforeCreate', hook);
    const draft = await writeDraft(write, {
      entryId: entry.id,
      locale,
      data: outcome.data,
      previous: undefined,
      mode: 'revision',
      reason: 'create',
    });
    await writeEntryEvent(trx, model, 'entry.created', entry.id, { locale, revisionId: draft.revision_id });
    if (publish) {
      await publishLocalesInTransaction(
        { write, snapshot: context.snapshot, hooks: context.hooks, seq: publishSeqOf(context, trx) },
        entry.id,
        [locale],
        [draft],
      );
    }
    await syncEntryUniqueValues(write, entry.id);
    await context.hooks.run('afterCreate', hook);
    return entry.id;
  });
  return viewAfterWrite(context, model, policy, entryId, locale);
};

export type UpdateEntryInput = {
  locale?: string;
  /** The draft version the editor saw; null creates this locale's version of the entry. */
  expectedVersion: number | null;
  data?: unknown;
  /** Autosave: moves the draft head only (no revision) and does not enforce `required`. */
  autosave?: boolean;
};

type DraftChange = {
  previous: HeadRecord | undefined;
  locale: string;
  data: ContentData;
  mode: 'revision' | 'autosave';
};

/** The main draft plus every other locale's draft that receives changed shared values (fan-out). */
const draftChanges = (
  model: ContentModel,
  heads: readonly HeadRecord[],
  main: {
    locale: string;
    previous: HeadRecord | undefined;
    before: ContentData;
    after: ContentData;
    autosave: boolean;
  },
): DraftChange[] => {
  const changes: DraftChange[] = [
    {
      previous: main.previous,
      locale: main.locale,
      data: main.after,
      mode: main.autosave ? 'autosave' : 'revision',
    },
  ];
  if (!model.definition.localized) {
    return changes;
  }
  const shared = changedSharedFieldIds(model.definition, main.before, main.after);
  if (shared.size === 0) {
    return changes;
  }
  for (const other of heads.filter((head) => head.state === 'draft' && head.locale !== main.locale)) {
    changes.push({
      previous: other,
      locale: other.locale,
      data: withSharedValuesOf(model.definition, other.data, main.after, shared),
      // A draft with unsaved autosaved work stays an autosave; otherwise the fan-out is a saved revision.
      mode: main.autosave || other.autosaved_at ? 'autosave' : 'revision',
    });
  }
  return changes;
};

/** The base document for a locale that has no draft yet: shared values from another locale, localized defaults. */
const newLocaleBase = (model: ContentModel, heads: readonly HeadRecord[]): ContentData => {
  const source = heads.find((head) => head.state === 'draft');
  return withSharedValuesOf(model.definition, defaultsOf(model.definition, true), source?.data ?? {});
};

const saveDraftChanges = async (
  context: ContentServiceContext,
  write: WriteContext,
  entryId: string,
  changes: readonly DraftChange[],
  reason: 'save' | 'restore' | 'localize',
) => {
  const written: HeadRecord[] = [];
  for (const change of changes) {
    written.push(
      await writeDraft(write, {
        entryId,
        locale: change.locale,
        data: change.data,
        previous: change.previous,
        mode: change.mode,
        reason: change.previous ? (reason === 'localize' ? 'save' : reason) : 'localize',
      }),
    );
  }
  if (!write.model.definition.draftAndPublish) {
    const heads = await entryHeadsRepository.lockForEntry(entryId, write.trx);
    await publishLocalesInTransaction(
      { write, snapshot: context.snapshot, hooks: context.hooks, seq: publishSeqOf(context, write.trx) },
      entryId,
      changes.map((change) => change.locale),
      heads,
    );
  }
  return written;
};

export const updateEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: UpdateEntryInput,
): Promise<AdminEntryView> => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'update');
  const locale = writeLocaleFor(context.snapshot, model.definition, input.locale);
  const autosave = Boolean(input.autosave) && model.definition.draftAndPublish;
  const validator = buildValidator(context.snapshot, model);
  const patch = inputPatch(validator, model, policy.writeMask, input.data);
  let servedLocale = locale;
  await runEntryWrite(context.db, model, [locale], async (trx) => {
    const write: WriteContext = { trx, model, actor: context.actor, now: new Date() };
    assertEntryVisible(
      policy,
      context.actor,
      await entriesRepository.lockLive(id, model.definition.id, trx),
      id,
    );
    const heads = await entryHeadsRepository.lockForEntry(id, trx);
    // Non-localized entries keep their heads in the locale they were created in.
    const targetLocale = model.definition.localized
      ? locale
      : (heads.find((head) => head.state === 'draft')?.locale ?? locale);
    servedLocale = targetLocale;
    const previous = heads.find((head) => head.state === 'draft' && head.locale === targetLocale);
    if (!previous && (!model.definition.localized || input.expectedVersion !== null)) {
      throw entryLocaleNotFound(
        id,
        targetLocale,
        heads.filter((head) => head.state === 'draft').map((head) => head.locale),
      );
    }
    if (previous && previous.version !== input.expectedVersion) {
      throw contentVersionConflict(input.expectedVersion, previous.version);
    }
    const before = previous?.data ?? newLocaleBase(model, heads);
    const outcome = validated(validator, applyPatch(before, patch), autosave);
    await assertTargets(trx, outcome);
    const hook = {
      trx,
      model,
      entryId: id,
      locale: targetLocale,
      data: outcome.data,
      before,
      actor: context.actor,
    };
    await context.hooks.run('beforeUpdate', hook);
    const changes = draftChanges(model, heads, {
      locale: targetLocale,
      previous,
      before,
      after: outcome.data,
      autosave,
    });
    const written = await saveDraftChanges(context, write, id, changes, previous ? 'save' : 'localize');
    await syncEntryUniqueValues(write, id);
    await touchEntry(write, id);
    if (!autosave) {
      await writeEntryEvent(trx, model, 'entry.updated', id, {
        locale: targetLocale,
        locales: changes.map((change) => change.locale),
        revisionId: written[0]?.revision_id ?? null,
      });
      // Autosaves are not saves: post-commit work (webhooks, after hooks) follows saved revisions only.
      await context.hooks.run('afterUpdate', hook);
    }
  });
  return viewAfterWrite(context, model, policy, id, servedLocale);
};

/** Brings back an older revision as the new draft of its locale (a new revision; history is never rewritten). */
export const restoreRevision = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  revisionId: string,
  input: { expectedVersion: number },
): Promise<AdminEntryView> => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'update');
  const revision = await contentRevisionsRepository.findById(revisionId, context.db);
  if (!revision || revision.entry_id !== id) {
    throw revisionNotFound(revisionId);
  }
  const validator = buildValidator(context.snapshot, model);
  await runEntryWrite(context.db, model, [revision.locale], async (trx) => {
    const write: WriteContext = { trx, model, actor: context.actor, now: new Date() };
    assertEntryVisible(
      policy,
      context.actor,
      await entriesRepository.lockLive(id, model.definition.id, trx),
      id,
    );
    const heads = await entryHeadsRepository.lockForEntry(id, trx);
    const previous = heads.find((head) => head.state === 'draft' && head.locale === revision.locale);
    if (!previous || previous.version !== input.expectedVersion) {
      throw contentVersionConflict(input.expectedVersion, previous?.version ?? null);
    }
    // Restored values must still satisfy the current schema (it may have changed since).
    const outcome = validated(validator, revision.data, false);
    assertWritable(
      policy.writeMask,
      model.definition.fields,
      changedSharedFieldIds(model.definition, previous.data, outcome.data),
    );
    await assertTargets(trx, outcome);
    const changes = draftChanges(model, heads, {
      locale: revision.locale,
      previous,
      before: previous.data,
      after: outcome.data,
      autosave: false,
    });
    await saveDraftChanges(context, write, id, changes, 'restore');
    await syncEntryUniqueValues(write, id);
    await touchEntry(write, id);
    await writeEntryEvent(trx, model, 'entry.restored', id, {
      locale: revision.locale,
      fromRevisionId: revisionId,
    });
    await auditEntry(trx, context, model, 'content.restore', id, { locale: revision.locale, revisionId });
  });
  return viewAfterWrite(context, model, policy, id, revision.locale);
};

/** Soft-deletes an entry: heads, edges and registry rows go; revisions stay as history. */
export const deleteEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
): Promise<void> => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'delete');
  await runEntryWrite(context.db, model, [], async (trx) => {
    const now = new Date();
    assertEntryVisible(
      policy,
      context.actor,
      await entriesRepository.lockLive(id, model.definition.id, trx),
      id,
    );
    const referrers = await relationEdgesRepository.findReferrers(id, 10, trx);
    if (referrers.length > 0) {
      throw entryReferenced(
        referrers.map((row) => ({
          entryId: row.source_entry_id,
          modelId: row.model_id,
          locale: row.locale,
          state: row.state,
        })),
      );
    }
    const hook = { trx, model, entryId: id, locale: null, actor: context.actor };
    await context.hooks.run('beforeDelete', hook);
    const wasPublished = await publicationsRepository.hasOpen(id, trx);
    const seq = wasPublished
      ? await publicationsRepository.nextSeq(trx, context.site.id, {
          source: 'delete',
          actor: actorColumns(context.actor),
        })
      : null;
    if (seq !== null) {
      await publicationsRepository.close(id, null, seq, trx);
    }
    await entryHeadsRepository.removeForEntry(id, trx);
    await uniqueValuesRepository.removeForEntry(id, trx);
    await mediaReferencesService.removeReferences(trx, { entryId: id });
    await entriesRepository.softDelete(id, now, trx);
    await writeEntryEvent(trx, model, 'entry.deleted', id, { wasPublished, snapshot: seq });
    await auditEntry(trx, context, model, 'content.delete', id, { wasPublished, snapshot: seq });
    await context.hooks.run('afterDelete', hook);
  });
};

/**
 * Copies every locale's draft into a new entry. Unique fields are left empty (a copy could never satisfy
 * them) and the copy is flagged as not fully validated, so the editor completes it before saving.
 */
export const duplicateEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
): Promise<AdminEntryView> => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'create');
  const read = await modelWithPolicy(context, modelKey, 'read');
  if (model.definition.kind === 'singleton') {
    throw singletonExists(modelKey);
  }
  const validator = buildValidator(context.snapshot, model);
  const unique = new Set(uniqueFields(model.definition).map((field) => field.id));
  let firstLocale: string | undefined;
  const newId = await runEntryWrite(context.db, model, [], async (trx) => {
    const write: WriteContext = { trx, model, actor: context.actor, now: new Date() };
    assertEntryVisible(
      read.policy,
      context.actor,
      await entriesRepository.findLive(id, model.definition.id, trx),
      id,
    );
    const drafts = (await entryHeadsRepository.findForEntry(id, trx)).filter(
      (head) => head.state === 'draft',
    );
    const entry = await entriesRepository.insert(
      { siteId: context.site.id, modelId: model.definition.id, ...ownerOf(context) },
      trx,
    );
    for (const draft of drafts) {
      const copy = Object.fromEntries(Object.entries(draft.data).filter(([key]) => !unique.has(key)));
      assertWritable(policy.writeMask, model.definition.fields, Object.keys(copy));
      const outcome = validated(validator, copy, true);
      await assertTargets(trx, outcome);
      await writeDraft(write, {
        entryId: entry.id,
        locale: draft.locale,
        data: outcome.data,
        previous: undefined,
        mode: 'lenient',
        reason: 'duplicate',
      });
      firstLocale ??= draft.locale;
    }
    await writeEntryEvent(trx, model, 'entry.created', entry.id, { duplicateOf: id });
    return entry.id;
  });
  return viewAfterWrite(context, model, policy, newId, firstLocale);
};
