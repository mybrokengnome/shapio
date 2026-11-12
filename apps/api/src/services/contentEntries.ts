import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import type { Transaction } from 'kysely';
import {
  assertWritable,
  ownershipOfNewEntry,
  pickMasked,
  rowReadMask,
  rowWriteMask,
} from '../content/compiler/policy.js';
import {
  contentVersionConflict,
  entryLocaleNotFound,
  entryReferenced,
  revisionNotFound,
  singletonExists,
} from '../content/errors.js';
import {
  assignItemIds,
  componentLookupOf,
  itemIdKeyOf,
  itemIdScopeOf,
  withItemIds,
  type ItemIdScope,
} from '../content/itemIds.js';
import {
  changedFieldIds,
  changedSharedFieldIds,
  sharedValuesOnlyRenumbered,
  withSharedValuesOf,
  writeLocaleFor,
} from '../content/locales.js';
import type { ContentModel } from '../content/model.js';
import { validateRevisionData } from '../content/revisionData.js';
import { sameContent } from '../content/sameContent.js';
import { uniqueFields } from '../content/unique.js';
import { buildValidator, type ModelValidator, type ValidationOutcome } from '../content/validator/index.js';
import { contentInvalid } from '../content/validator/issues.js';
import { fieldsWithoutItemIds } from '../content/withoutItemIds.js';
import { syncEntryUniqueValues, touchEntry, writeDraft, type WriteContext } from '../content/write/heads.js';
import { withUniqueItemIds } from '../content/write/itemIdUniqueness.js';
import { assertComponentListCaps, keepUnreadableComponentFields } from '../content/write/keepUnreadable.js';
import { withLookalikesInIdOrder } from '../content/write/lookalikeOrder.js';
import {
  assertTargets,
  mediaIdsOf,
  relationsByPath,
  withoutDeadPutBackTargets,
} from '../content/write/references.js';
import { runEntryWrite } from '../content/write/transaction.js';
import type { ContentData } from '../db/contentData.js';
import type { DB } from '../db/types.js';
import type { Policy } from '../permissions/types.js';
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
  entryModelWithPolicy,
  modelWithCreatePolicy,
  modelWithPolicy,
  writeEntryEvent,
  type ContentServiceContext,
} from './contentAccess.js';
import { auditPublished, publishLocalesInTransaction } from './contentPublishing.js';
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

/** The values of `data` under the model's current (effective) fields; keys of any other field are left out. */
const currentFieldsOf = (model: ContentModel, data: Readonly<ContentData>): ContentData => {
  const known = new Set(model.definition.fields.map((field) => field.id));
  return Object.fromEntries(Object.entries(data).filter(([key]) => known.has(key)));
};

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

/**
 * The input as a validated patch. Callers check its fields against the entry's write mask (`rowWriteMask`).
 * A component list longer than a write pairs (the field's `max`, at most `CARRY_MAX_ITEMS`) is refused here
 * (`TOO_MANY` at its path), before any pairing or item ID work.
 */
const inputPatch = (validator: ModelValidator, model: ContentModel, data: unknown) => {
  const { patch, issues } = validator.fromInput((data ?? {}) as Record<string, unknown>);
  if (issues.length > 0) {
    throw contentInvalid(issues);
  }
  assertComponentListCaps(patch, model.definition.fields, componentLookupOf(model.components));
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

const ownerOf = (context: ContentServiceContext) => {
  const ownership = ownershipOfNewEntry(context.actor);
  return {
    ownerAppUserId: ownership.owner_app_user_id,
    createdByAdminId: ownership.created_by_admin_id,
  };
};

/** The write mask on the entry a create produces: the caller owns it (issue #80). */
const newEntryWriteMask = (context: ContentServiceContext, policy: Policy) =>
  rowWriteMask(policy, context.actor, ownershipOfNewEntry(context.actor));

export type CreateEntryInput = {
  locale?: string;
  data?: unknown;
  publish?: boolean;
  /** Told the data the entry is created with (storage form), its items' new IDs included (plan item-ids). */
  onWritten?: (data: Readonly<ContentData>) => void;
};

export const createEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  input: CreateEntryInput,
): Promise<AdminEntryView> => {
  const { model, policy } = await modelWithCreatePolicy(context, modelKey);
  const publish = Boolean(input.publish) || !model.definition.draftAndPublish;
  if (input.publish && model.definition.draftAndPublish) {
    await modelWithPolicy(context, modelKey, 'publish');
  }
  const locale = writeLocaleFor(context.snapshot, model.definition, input.locale);
  const validator = buildValidator(context.snapshot, model);
  const patch = inputPatch(validator, model, input.data);
  assertWritable(newEntryWriteMask(context, policy), model.definition.fields, Object.keys(patch));
  // A new entry's items get the server's IDs, a new one per instance, whatever the body sent (plan item-ids).
  const outcome = validated(
    validator,
    assignItemIds(
      applyPatch(defaultsOf(model.definition), patch),
      model.definition.fields,
      componentLookupOf(model.components),
      { fresh: true },
    ),
    false,
  );
  const entryId = await runEntryWrite(context.db, model, context.site.id, [locale], async (trx) => {
    const write: WriteContext = {
      trx,
      siteId: context.site.id,
      model,
      actor: context.actor,
      now: new Date(),
    };
    if (model.definition.kind === 'singleton') {
      await contentGuardsRepository.lockSingleton(model.definition.id, context.site.id, trx);
      if ((await entriesRepository.countLive(model.definition.id, context.site.id, trx)) > 0) {
        throw singletonExists(modelKey);
      }
    }
    await assertTargets(trx, outcome, context.site.id);
    const entry = await entriesRepository.insert(
      { siteId: context.site.id, modelId: model.definition.id, ...ownerOf(context) },
      trx,
    );
    const hook = {
      trx,
      site: context.site,
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
    await writeEntryEvent(trx, context.site.id, model, 'entry.created', entry.id, {
      locale,
      revisionId: draft.revision_id,
    });
    if (publish) {
      const published = await publishLocalesInTransaction(
        {
          write,
          site: context.site,
          snapshot: context.snapshot,
          hooks: context.hooks,
          seq: publishSeqOf(context, trx),
        },
        entry.id,
        [locale],
        [draft],
      );
      await auditPublished(trx, context, model, entry.id, published, { via: 'create' });
    }
    await syncEntryUniqueValues(write, entry.id);
    await context.hooks.run('afterCreate', hook);
    return entry.id;
  });
  input.onWritten?.(outcome.data);
  return viewAfterWrite(context, model, policy, entryId, locale);
};

export type UpdateEntryInput = {
  locale?: string;
  /** The draft version the editor saw; null creates this locale's version of the entry. */
  expectedVersion: number | null;
  data?: unknown;
  /** Autosave: moves the draft head only (no revision) and does not enforce `required`. */
  autosave?: boolean;
  /**
   * After `data` is validated and authorized as always, inside the write: values the patch's component fields
   * carry over from the locked draft the write starts from (a delivery caller never wipes what it cannot read).
   * It may only change values under keys the patch already names.
   */
  carry?: (patch: Readonly<ContentData>, base: DraftUpdateBase, model: ContentModel) => ContentData;
  /**
   * Whether the caller sees everything stored in the items of a component list (nothing in them hidden from it):
   * only there is a swap of items identical in everything stored an unchanged save (`isUnchangedSave`), so the
   * answer never tells a caller whether values hidden from it differ. Absent: every list (admin writes).
   */
  seesAllStoredIn?: (field: FieldDefinition) => boolean;
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
    /**
     * What the locale held and holds after, each item with its ID (stored, or derived for items saved before IDs):
     * a shared field fans out only when its content or its items' IDs changed, never because an item that was
     * sent back gained the ID a read already gave it.
     */
    beforeWithIds: ContentData;
    after: ContentData;
    afterWithIds: ContentData;
    autosave: boolean;
    /** Where the written locale's items derive their IDs: the other locales' drafts are read the same way. */
    idScope: ItemIdScope;
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
  const shared = changedSharedFieldIds(model.definition, main.beforeWithIds, main.afterWithIds);
  if (shared.size === 0) {
    return changes;
  }
  const componentOf = componentLookupOf(model.components);
  for (const other of heads.filter((head) => head.state === 'draft' && head.locale !== main.locale)) {
    const otherWithIds = withItemIds(other.data, model.definition.fields, componentOf, {
      ...main.idScope,
      ...(main.idScope.locale === undefined ? {} : { locale: other.locale }),
    });
    if (sharedValuesOnlyRenumbered(model.definition, otherWithIds, main.afterWithIds, shared, componentOf)) {
      // Identical items reordered: the same content and IDs there, so nothing to write (no revision, no status).
      continue;
    }
    changes.push({
      previous: other,
      locale: other.locale,
      // The same uniqueness pass as the written locale: shared items copied in never repeat an ID there.
      data: withUniqueItemIds(
        withSharedValuesOf(model.definition, other.data, main.after, shared),
        model.definition.fields,
        componentOf,
      ),
      // A draft with unsaved autosaved work stays an autosave; otherwise the fan-out is a saved revision.
      mode: main.autosave || other.autosaved_at ? 'autosave' : 'revision',
    });
  }
  return changes;
};

/** The base document for a locale that has no draft yet: shared values from another locale, localized defaults. */
export const newLocaleBase = (model: ContentModel, heads: readonly HeadRecord[]): ContentData => {
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
      {
        write,
        site: context.site,
        snapshot: context.snapshot,
        hooks: context.hooks,
        seq: publishSeqOf(context, write.trx),
      },
      entryId,
      changes.map((change) => change.locale),
      heads,
    );
  }
  return written;
};

/**
 * A save that changes nothing: the draft exists, holds no autosaved work (saving that must still make it a
 * revision), and the validated data is what it already has.
 */
const isUnchangedSave = (
  model: ContentModel,
  previous: HeadRecord | undefined,
  beforeWithIds: Readonly<ContentData>,
  after: ContentData,
  seesAllStoredIn: (field: FieldDefinition) => boolean = () => true,
): previous is HeadRecord => {
  if (previous === undefined || previous.autosaved_at !== null) {
    return false;
  }
  // Compared with every item's ID (stored, or derived for items saved before IDs): a list sent back as it was is
  // no change whether its IDs were persisted or not. Items swapped by their IDs are a change, unless the items
  // are identical in everything stored (hidden values and nested items included) in a list the caller sees whole:
  // then only which identical item carries which ID differs, which nothing shows. Where the list can hold values
  // hidden from the caller the swap stays a change, so the answer says nothing about those values.
  const componentOf = componentLookupOf(model.components);
  return sameContent(
    withLookalikesInIdOrder(beforeWithIds, model.definition.fields, componentOf, seesAllStoredIn),
    withLookalikesInIdOrder(after, model.definition.fields, componentOf, seesAllStoredIn),
  );
};

/** Stored data without item IDs, for comparisons of content (plan item-ids). */
const withoutIds = (model: ContentModel, data: Readonly<ContentData>): ContentData =>
  fieldsWithoutItemIds(model.definition.fields, data, componentLookupOf(model.components));

/**
 * Every head of the entry but the draft written, each with its items' IDs (derived in its own locale): an admin
 * reads them all, so an item ID one of them shows where the written draft lacks it (an item copied from another
 * locale, or from the published version) is a new item, never an unknown ID (`shownElsewhere` in
 * content/write/listPairing.ts). Only made when the patch sends a component value.
 */
const otherHeadsWithIds = (
  model: ContentModel,
  heads: readonly HeadRecord[],
  written: HeadRecord | undefined,
  idScope: ItemIdScope,
  patch: Readonly<ContentData>,
): ContentData[] => {
  const sendsItems = model.definition.fields.some(
    (field) => (field.type === 'component' || field.type === 'dynamiczone') && field.id in patch,
  );
  if (!sendsItems) {
    return [];
  }
  const componentOf = componentLookupOf(model.components);
  return heads.flatMap((head) =>
    head !== written && typeof head.data === 'object' && head.data !== null && !Array.isArray(head.data)
      ? [
          withItemIds(head.data, model.definition.fields, componentOf, {
            ...idScope,
            ...(idScope.locale === undefined ? {} : { locale: head.locale }),
          }),
        ]
      : [],
  );
};

/** What a draft update reads before it decides its patch (the locked heads and the draft it replaces). */
export type DraftUpdateBase = {
  before: Readonly<ContentData>;
  /** `before` with every component instance's ID (stored or derived: `withItemIds`), what items continue. */
  beforeWithIds: Readonly<ContentData>;
  previous: HeadRecord | undefined;
  heads: readonly HeadRecord[];
};

export type EntryUpdateWrite = {
  model: ContentModel;
  policy: Policy;
  validator: ModelValidator;
  id: string;
  locale: string;
  autosave: boolean;
  /**
   * The draft version the caller saw; null creates this locale's version. Left out, the version is not
   * checked: the caller guards what it changes in `patchOf` (the heads are locked by then).
   */
  expectedVersion?: number | null;
  /**
   * The patch (field IDs; null clears a field), or a function that makes it from the locked draft (it may
   * throw to refuse the write).
   */
  patch: Readonly<ContentData> | ((base: DraftUpdateBase) => ContentData);
  /** `UpdateEntryInput.carry`, applied once the version is checked. */
  carry?: (patch: Readonly<ContentData>, base: DraftUpdateBase) => ContentData;
  /** `UpdateEntryInput.seesAllStoredIn`. */
  seesAllStoredIn?: (field: FieldDefinition) => boolean;
};

/**
 * The body of `updateEntry` inside a transaction the caller holds, after `guardEntryWrite` (fill accepts
 * compose it with a change set item). Returns the locale written and its draft head afterwards.
 */
export const writeEntryUpdate = async (
  trx: Transaction<DB>,
  context: ContentServiceContext,
  input: EntryUpdateWrite,
): Promise<{ locale: string; head: HeadRecord | undefined }> => {
  const { model, policy, id, autosave } = input;
  const write: WriteContext = { trx, siteId: context.site.id, model, actor: context.actor, now: new Date() };
  const entry = assertEntryVisible(
    policy,
    context.actor,
    await entriesRepository.lockLive(id, model.definition.id, context.site.id, trx),
    id,
  );
  const writeMask = rowWriteMask(policy, context.actor, entry);
  if (typeof input.patch !== 'function') {
    // After the row check, so an entry the caller cannot see stays a 404 (issue #80).
    assertWritable(writeMask, model.definition.fields, Object.keys(input.patch));
  }
  const heads = await entryHeadsRepository.lockForEntry(id, trx);
  // Non-localized entries keep their heads in the locale they were created in.
  const targetLocale = model.definition.localized
    ? input.locale
    : (heads.find((head) => head.state === 'draft')?.locale ?? input.locale);
  const previous = heads.find((head) => head.state === 'draft' && head.locale === targetLocale);
  if (!previous && (!model.definition.localized || input.expectedVersion !== null)) {
    throw entryLocaleNotFound(
      id,
      targetLocale,
      heads.filter((head) => head.state === 'draft').map((head) => head.locale),
    );
  }
  if (previous && input.expectedVersion !== undefined && previous.version !== input.expectedVersion) {
    throw contentVersionConflict(input.expectedVersion, previous.version);
  }
  const before = previous?.data ?? newLocaleBase(model, heads);
  const componentOf = componentLookupOf(model.components);
  const idScope = itemIdScopeOf(await itemIdKeyOf(trx), id, model, targetLocale);
  const beforeWithIds = withItemIds(before, model.definition.fields, componentOf, idScope);
  const base: DraftUpdateBase = { before, beforeWithIds, previous, heads };
  let patch = input.patch;
  if (typeof patch === 'function') {
    patch = patch(base);
    assertWritable(writeMask, model.definition.fields, Object.keys(patch));
  }
  // The relation targets the body itself names, by position, before anything is carried over (`assertTargets`).
  const sentRelations = relationsByPath(model, patch);
  // Every written component instance continues a stored one, or is new (plan item-ids): delivery writes carry
  // over what their caller cannot see along a pairing made with the body; any other write keeps the IDs only.
  patch = input.carry
    ? input.carry(patch, base)
    : keepUnreadableComponentFields(patch, beforeWithIds, model.definition.fields, componentOf, () => true, {
        carryNothing: true,
        shown: otherHeadsWithIds(model, heads, previous, idScope, patch),
      });
  // Targets the server put back that are deleted are dropped, never kept (`withoutDeadPutBackTargets`).
  const kept = patch;
  patch = await withoutDeadPutBackTargets(trx, model, patch, sentRelations, context.site.id);
  const outcomeOf = (written: ContentData) => {
    const checked = validated(input.validator, applyPatch(before, written), autosave);
    // Item IDs are unique in what is stored (plan item-ids): a later repeat gets a renewed ID.
    return { ...checked, data: withUniqueItemIds(checked.data, model.definition.fields, componentOf) };
  };
  // Both sides with every item's ID: items the body left out (or sent back) of an entry saved before item IDs
  // carry the IDs a read derives for them on both sides, so only content and IDs the body changed count.
  const withIdsOf = (data: ContentData) => withItemIds(data, model.definition.fields, componentOf, idScope);
  const unchanged = (data: ContentData) =>
    isUnchangedSave(model, previous, beforeWithIds, withIdsOf(data), input.seesAllStoredIn);
  const outcome = outcomeOf(patch);
  const afterWithIds = withIdsOf(outcome.data);
  // A save that would change nothing but drop a dead target the caller cannot see changes nothing either: whether
  // a hidden target was deleted or is only unpublished never changes the answer (the next real change drops it).
  if (unchanged(outcome.data) || (kept !== patch && unchanged(outcomeOf(kept).data))) {
    // Nothing to record: no revision, version, event or hook. The caller gets the draft as it is.
    return { locale: targetLocale, head: previous };
  }
  await assertTargets(trx, outcome, context.site.id, mediaIdsOf(model, [before]), sentRelations);
  const hook = {
    trx,
    site: context.site,
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
    beforeWithIds,
    after: outcome.data,
    afterWithIds,
    autosave,
    idScope,
  });
  const written = await saveDraftChanges(context, write, id, changes, previous ? 'save' : 'localize');
  await syncEntryUniqueValues(write, id);
  await touchEntry(write, id);
  if (!autosave) {
    await writeEntryEvent(trx, context.site.id, model, 'entry.updated', id, {
      locale: targetLocale,
      locales: changes.map((change) => change.locale),
      revisionId: written[0]?.revision_id ?? null,
    });
    // Autosaves are not saves: post-commit work (webhooks, after hooks) follows saved revisions only.
    await context.hooks.run('afterUpdate', hook);
  }
  return { locale: targetLocale, head: written[0] };
};

/**
 * `updateEntry`, also answering the draft head of the written locale as the write left it: the head it wrote,
 * or the draft as it was when the save changed nothing. Its `data` is what was stored (never read back).
 */
export const updateEntryWithHead = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: UpdateEntryInput,
): Promise<{ view: AdminEntryView; head: HeadRecord | undefined }> => {
  const { model, policy } = await entryModelWithPolicy(context, modelKey, id, 'update');
  const locale = writeLocaleFor(context.snapshot, model.definition, input.locale);
  const validator = buildValidator(context.snapshot, model);
  const patch = inputPatch(validator, model, input.data);
  const { carry, seesAllStoredIn } = input;
  const written = await runEntryWrite(context.db, model, context.site.id, [locale], (trx) =>
    writeEntryUpdate(trx, context, {
      model,
      policy,
      validator,
      id,
      locale,
      autosave: Boolean(input.autosave) && model.definition.draftAndPublish,
      expectedVersion: input.expectedVersion,
      patch,
      ...(carry ? { carry: (current, base) => carry(current, base, model) } : {}),
      ...(seesAllStoredIn ? { seesAllStoredIn } : {}),
    }),
  );
  return { view: await viewAfterWrite(context, model, policy, id, written.locale), head: written.head };
};

export const updateEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: UpdateEntryInput,
): Promise<AdminEntryView> => (await updateEntryWithHead(context, modelKey, id, input)).view;

/** Brings back an older revision as the new draft of its locale (a new revision; history is never rewritten). */
export const restoreRevision = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  revisionId: string,
  input: { expectedVersion: number },
): Promise<AdminEntryView> => {
  const { model, policy } = await entryModelWithPolicy(context, modelKey, id, 'update');
  const revision = await contentRevisionsRepository.findById(revisionId, context.db);
  if (!revision || revision.entry_id !== id) {
    throw revisionNotFound(revisionId);
  }
  const validator = buildValidator(context.snapshot, model);
  // A non-localized entry's revisions may carry a locale its heads have since left (a deleted locale's).
  const writeLocale = model.definition.localized
    ? revision.locale
    : writeLocaleFor(context.snapshot, model.definition, undefined);
  let targetLocale = revision.locale;
  await runEntryWrite(context.db, model, context.site.id, [writeLocale], async (trx) => {
    const write: WriteContext = {
      trx,
      siteId: context.site.id,
      model,
      actor: context.actor,
      now: new Date(),
    };
    const entry = assertEntryVisible(
      policy,
      context.actor,
      await entriesRepository.lockLive(id, model.definition.id, context.site.id, trx),
      id,
    );
    const heads = await entryHeadsRepository.lockForEntry(id, trx);
    if (!model.definition.localized) {
      targetLocale = heads.find((head) => head.state === 'draft')?.locale ?? revision.locale;
    }
    const previous = heads.find((head) => head.state === 'draft' && head.locale === targetLocale);
    if (!previous || previous.version !== input.expectedVersion) {
      throw contentVersionConflict(input.expectedVersion, previous?.version ?? null);
    }
    // Restored values must still satisfy the current schema (it may have changed since); values saved under
    // an earlier field type come back empty, as the revision's view shows them.
    const validated = validateRevisionData(validator, revision.data);
    if (validated.issues.length > 0) {
      throw contentInvalid(validated.issues);
    }
    // Only the entry's current fields come back: a revision written under another kind (or before a field
    // was removed) holds keys this kind lacks, which must not hide in the draft and reappear after a later
    // change of kind (plan polymorphic-types, decision 6). A revision repeating an item ID (stored before IDs
    // were checked) comes back with the later repeats renewed (plan item-ids).
    const outcome = {
      ...validated,
      data: withUniqueItemIds(
        currentFieldsOf(model, validated.data),
        model.definition.fields,
        componentLookupOf(model.components),
      ),
    };
    // Every field the restore changes in this locale (shared ones fan out from it), issue #103.
    assertWritable(
      rowWriteMask(policy, context.actor, entry),
      model.definition.fields,
      // Item IDs alone are no change (a revision saved before item IDs existed holds none).
      changedFieldIds(
        model.definition.fields,
        withoutIds(model, previous.data),
        withoutIds(model, outcome.data),
      ),
    );
    await assertTargets(trx, outcome, context.site.id, mediaIdsOf(model, [previous.data]));
    const idScope = itemIdScopeOf(await itemIdKeyOf(trx), id, model, targetLocale);
    const componentOf = componentLookupOf(model.components);
    const changes = draftChanges(model, heads, {
      locale: targetLocale,
      previous,
      beforeWithIds: withItemIds(previous.data, model.definition.fields, componentOf, idScope),
      after: outcome.data,
      afterWithIds: withItemIds(outcome.data, model.definition.fields, componentOf, idScope),
      autosave: false,
      idScope,
    });
    await saveDraftChanges(context, write, id, changes, 'restore');
    await syncEntryUniqueValues(write, id);
    await touchEntry(write, id);
    await writeEntryEvent(trx, context.site.id, model, 'entry.restored', id, {
      locale: targetLocale,
      fromRevisionId: revisionId,
    });
    await auditEntry(trx, context, model, 'content.restore', id, { locale: targetLocale, revisionId });
  });
  return viewAfterWrite(context, model, policy, id, targetLocale);
};

/** Soft-deletes an entry: heads, edges and registry rows go; revisions stay as history. */
export const deleteEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
): Promise<void> => {
  const { model, policy } = await entryModelWithPolicy(context, modelKey, id, 'delete');
  await runEntryWrite(context.db, model, context.site.id, [], async (trx) => {
    const now = new Date();
    assertEntryVisible(
      policy,
      context.actor,
      await entriesRepository.lockLive(id, model.definition.id, context.site.id, trx),
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
    const hook = { trx, site: context.site, model, entryId: id, locale: null, actor: context.actor };
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
    await writeEntryEvent(trx, context.site.id, model, 'entry.deleted', id, { wasPublished, snapshot: seq });
    await auditEntry(trx, context, model, 'content.delete', id, { wasPublished, snapshot: seq });
    await context.hooks.run('afterDelete', hook);
  });
};

/**
 * Copies every locale's draft into a new entry. Unique fields are left empty (a copy could never satisfy
 * them), and so are fields the caller may not read on the source. The copy is flagged as not fully validated,
 * so the editor completes it before saving.
 */
export const duplicateEntry = async (
  context: ContentServiceContext,
  routeKey: string,
  id: string,
): Promise<AdminEntryView> => {
  // A copy is of the entry's own kind, whichever family route asked for it (plan polymorphic-types).
  const kindKey = (await entryModelWithPolicy(context, routeKey, id, 'read')).model.definition.apiKey;
  const { model, policy } = await modelWithCreatePolicy(context, kindKey);
  const read = await modelWithPolicy(context, kindKey, 'read');
  if (model.definition.kind === 'singleton') {
    throw singletonExists(kindKey);
  }
  const validator = buildValidator(context.snapshot, model);
  const unique = new Set(uniqueFields(model.definition).map((field) => field.id));
  let firstLocale: string | undefined;
  const newId = await runEntryWrite(context.db, model, context.site.id, [], async (trx) => {
    const write: WriteContext = {
      trx,
      siteId: context.site.id,
      model,
      actor: context.actor,
      now: new Date(),
    };
    const source = assertEntryVisible(
      read.policy,
      context.actor,
      await entriesRepository.findLive(id, model.definition.id, context.site.id, trx),
      id,
    );
    // Only what the caller may read on the source is copied (issue #104); the rest is left empty like unique
    // fields, for the editor to fill before saving.
    const readable = rowReadMask(read.policy, context.actor, source);
    const drafts = (await entryHeadsRepository.findForEntry(id, trx)).filter(
      (head) => head.state === 'draft',
    );
    const entry = await entriesRepository.insert(
      { siteId: context.site.id, modelId: model.definition.id, ...ownerOf(context) },
      trx,
    );
    // The copy's items get new IDs, the same new ID for the same item in every locale (shared fields), and a
    // new one per instance: two source items repeating an ID are two items of the copy.
    const renew = new Map<string, string>();
    const componentOf = componentLookupOf(model.components);
    const key = await itemIdKeyOf(trx);
    for (const draft of drafts) {
      const withIds = withUniqueItemIds(
        withItemIds(
          draft.data,
          model.definition.fields,
          componentOf,
          itemIdScopeOf(key, id, model, draft.locale),
        ),
        model.definition.fields,
        componentOf,
      );
      const copy = assignItemIds(
        Object.fromEntries(
          Object.entries(pickMasked(readable, withIds)).filter(([field]) => !unique.has(field)),
        ),
        model.definition.fields,
        componentOf,
        { renew },
      );
      assertWritable(newEntryWriteMask(context, policy), model.definition.fields, Object.keys(copy));
      const outcome = validated(validator, copy, true);
      await assertTargets(trx, outcome, context.site.id, mediaIdsOf(model, [draft.data]));
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
    await writeEntryEvent(trx, context.site.id, model, 'entry.created', entry.id, { duplicateOf: id });
    return entry.id;
  });
  return viewAfterWrite(context, model, policy, newId, firstLocale);
};
