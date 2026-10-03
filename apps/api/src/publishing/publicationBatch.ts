import type { Transaction } from 'kysely';
import { publishingDisabled, unknownLocale } from '../content/errors.js';
import { writeLocaleFor } from '../content/locales.js';
import { resolveModelById, modelNotFound, type ContentModel } from '../content/model.js';
import {
  syncEntryUniqueValues,
  touchEntry,
  unpublishLocale,
  type WriteContext,
} from '../content/write/heads.js';
import { guardModelVersions, lockWriteLocales } from '../content/write/transaction.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import type { Policy } from '../permissions/types.js';
import * as contentRevisionsRepository from '../repositories/contentRevisions.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { HeadRecord } from '../repositories/entryHeads.js';
import { createSeqAllocator, type SeqAllocator, type SnapshotMeta } from '../repositories/publications.js';
import {
  assertEntryVisible,
  auditEntry,
  modelWithPolicy,
  writeEntryEvent,
  type ContentServiceContext,
} from '../services/contentAccess.js';
import {
  publishLocalesInTransaction,
  publishRevisionInTransaction,
  type PublishTransaction,
} from '../services/contentPublishing.js';

/**
 * Publishes and unpublishes several (entry, locale) items in ONE transaction with ONE publication sequence
 * number: scheduled publications (one item) and change sets (many). Either every item commits, with its
 * revisions, publication-log rows, outbox events and audit rows, or nothing does (brief §7, §10 "partial
 * failure leaves no half-published release"), and the batch is exactly one snapshot.
 *
 * It applies the entry write policy of `runEntryWrite` (ADR 0002) to every model in the batch, through the
 * same guard (`guardModelVersions`, `lockWriteLocales` in content/write/transaction.ts). Entries are locked
 * in ID order. Per-entry publishing reuses the content service's own transaction step.
 */
export type PublicationItem = {
  /** Caller's reference for error attribution (change set item ID, schedule ID). */
  ref: string;
  entryId: string;
  modelId: string;
  /** The locale to (un)publish. Ignored for non-localized models, whose entries have one locale. */
  locale: string;
  action: 'publish' | 'unpublish';
  /** Publish this exact revision (restore) instead of the current draft. */
  sourceRevisionId?: string | null;
  /** Strict ships: the draft head version the reviewer saw; a moved draft stops the batch (409). */
  expectedDraftVersion?: number;
};

export type PublicationResult = {
  ref: string;
  entryId: string;
  locale: string;
  action: 'publish' | 'unpublish';
  /** Publication sequence of the change; null for an unpublish of a locale that was not live. */
  snapshot: number | null;
  revisionId: string | null;
};

/** Which item stopped the batch, and why. Thrown after the transaction rolled back. */
export class PublicationItemError extends AppError {
  readonly ref: string;

  constructor(ref: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(
      cause instanceof AppError ? cause.statusCode : 500,
      cause instanceof AppError ? cause.code : 'PUBLICATION_FAILED',
      message,
      { ref, ...(cause instanceof AppError && cause.details !== undefined ? { cause: cause.details } : {}) },
      { cause },
    );
    this.name = 'PublicationItemError';
    this.ref = ref;
  }
}

export type BatchHooks<T> = {
  /** Runs first in the transaction (lock and check the schedule or release row). */
  before?: (trx: Transaction<DB>) => Promise<void>;
  /** Runs last in the transaction, with the results (mark rows done, write release events). */
  after?: (trx: Transaction<DB>, results: PublicationResult[]) => Promise<T>;
};

type ResolvedModel = { model: ContentModel; policy: Policy };

const resolveModels = async (context: ContentServiceContext, items: readonly PublicationItem[]) => {
  const models = new Map<string, ResolvedModel>();
  for (const modelId of new Set(items.map((item) => item.modelId))) {
    const model = resolveModelById(context.snapshot, modelId);
    if (!model) {
      const ref = items.find((item) => item.modelId === modelId)?.ref ?? modelId;
      throw new PublicationItemError(ref, modelNotFound(modelId));
    }
    if (!model.definition.draftAndPublish) {
      const ref = items.find((item) => item.modelId === modelId)?.ref ?? modelId;
      throw new PublicationItemError(ref, publishingDisabled(model.definition.apiKey));
    }
    models.set(modelId, await modelWithPolicy(context, model.definition.apiKey, 'publish'));
  }
  return models;
};

const lockItemLocales = async (
  trx: Transaction<DB>,
  items: readonly PublicationItem[],
  models: ReadonlyMap<string, ResolvedModel>,
) => {
  const codes = [
    ...new Set(
      items.filter((item) => models.get(item.modelId)?.model.definition.localized).map((item) => item.locale),
    ),
  ];
  const missing = await lockWriteLocales(trx, codes);
  if (missing !== undefined) {
    const ref = items.find((item) => item.locale === missing)?.ref ?? missing;
    throw new PublicationItemError(ref, unknownLocale(missing));
  }
};

/** Non-localized entries have one locale; the item's locale only matters for localized models. */
const localeOf = (
  context: ContentServiceContext,
  model: ContentModel,
  item: PublicationItem,
  heads: readonly HeadRecord[],
  state: 'draft' | 'published',
): string | undefined => {
  if (model.definition.localized) {
    return writeLocaleFor(context.snapshot, model.definition, item.locale);
  }
  return heads.find((head) => head.state === state)?.locale;
};

type EntryStep = { write: WriteContext; items: PublicationItem[]; heads: HeadRecord[]; seq: SeqAllocator };

const publishTransactionOf = (context: ContentServiceContext, step: EntryStep): PublishTransaction => ({
  write: step.write,
  site: context.site,
  snapshot: context.snapshot,
  hooks: context.hooks,
  seq: step.seq,
});

const draftChanged = (
  ref: string,
  entryId: string,
  locale: string,
  expected: number,
  current: number | null,
) =>
  new PublicationItemError(
    ref,
    new AppError(
      409,
      'CHANGE_SET_STALE',
      `The draft of entry ${entryId} (${locale}) changed since the review`,
      {
        entryId,
        locale,
        expectedDraftVersion: expected,
        currentDraftVersion: current,
      },
    ),
  );

/** Strict ships: every item that names a draft version must still be at it. */
const assertDraftVersions = (
  targets: ReadonlyArray<{ item: PublicationItem; locale: string | undefined }>,
  heads: readonly HeadRecord[],
  entryId: string,
) => {
  for (const { item, locale } of targets) {
    if (item.expectedDraftVersion === undefined || locale === undefined) {
      continue;
    }
    const draft = heads.find((head) => head.state === 'draft' && head.locale === locale);
    if (!draft || draft.version !== item.expectedDraftVersion) {
      throw draftChanged(item.ref, entryId, locale, item.expectedDraftVersion, draft?.version ?? null);
    }
  }
};

const resultOf = (
  item: PublicationItem,
  entryId: string,
  locale: string,
  published: { snapshot: number; revisionId: string } | undefined,
): PublicationResult => ({
  ref: item.ref,
  entryId,
  locale,
  action: 'publish',
  snapshot: published?.snapshot ?? null,
  revisionId: published?.revisionId ?? null,
});

/** Restore items: each publishes its source revision (which must belong to this entry and locale). */
const publishRevisionItems = async (
  context: ContentServiceContext,
  step: EntryStep,
  entryId: string,
  targets: ReadonlyArray<{ item: PublicationItem; locale: string }>,
) => {
  const results: PublicationResult[] = [];
  for (const { item, locale } of targets) {
    try {
      const source = await contentRevisionsRepository.findById(item.sourceRevisionId ?? '', step.write.trx);
      if (!source || source.entry_id !== entryId || source.locale !== locale) {
        throw new AppError(
          404,
          'REVISION_NOT_FOUND',
          `Revision ${item.sourceRevisionId} is not of this entry`,
        );
      }
      const published = await publishRevisionInTransaction(
        publishTransactionOf(context, step),
        entryId,
        locale,
        { id: source.id, data: source.data },
        step.heads,
      );
      results.push(resultOf(item, entryId, locale, published));
    } catch (error) {
      throw error instanceof PublicationItemError ? error : new PublicationItemError(item.ref, error);
    }
  }
  return results;
};

const publishEntryItems = async (context: ContentServiceContext, step: EntryStep, entryId: string) => {
  const { write, items, heads } = step;
  const targets = items
    .filter((item) => item.action === 'publish')
    .map((item) => ({
      item,
      locale: localeOf(context, write.model, item, heads, item.sourceRevisionId ? 'published' : 'draft'),
    }));
  if (targets.length === 0) {
    return [];
  }
  assertDraftVersions(targets, heads, entryId);
  const fromRevision = targets.filter(({ item }) => item.sourceRevisionId);
  const fromDraft = targets.filter(({ item }) => !item.sourceRevisionId);
  const missing = fromDraft.find((target) => target.locale === undefined);
  if (missing) {
    throw new PublicationItemError(
      missing.item.ref,
      new AppError(404, 'ENTRY_LOCALE_NOT_FOUND', `Entry ${entryId} has no draft to publish`),
    );
  }
  const results = await publishRevisionItems(
    context,
    step,
    entryId,
    fromRevision.map(({ item, locale }) => ({ item, locale: locale ?? item.locale })),
  );
  if (fromDraft.length === 0) {
    return results;
  }
  const locales = fromDraft.map((target) => target.locale as string);
  try {
    const published = await publishLocalesInTransaction(
      publishTransactionOf(context, step),
      entryId,
      locales,
      heads,
    );
    return [
      ...results,
      ...fromDraft.map(({ item, locale }) =>
        resultOf(
          item,
          entryId,
          locale as string,
          published.find((candidate) => candidate.locale === locale),
        ),
      ),
    ];
  } catch (error) {
    // The content service names the failing locale in its message; attribute it to that item.
    const failing =
      fromDraft.find(({ locale }) => error instanceof Error && error.message.includes(`(${locale})`)) ??
      fromDraft[0];
    throw new PublicationItemError(failing?.item.ref ?? entryId, error);
  }
};

const unpublishEntryItems = async (context: ContentServiceContext, step: EntryStep, entryId: string) => {
  const { write, items, heads } = step;
  const results: PublicationResult[] = [];
  const targets = items.filter((item) => item.action === 'unpublish');
  if (targets.length === 0) {
    return results;
  }
  const resolved = targets.map((item) => {
    const locale = localeOf(context, write.model, item, heads, 'published') ?? item.locale;
    return { item, locale, live: heads.some((head) => head.state === 'published' && head.locale === locale) };
  });
  // Like a direct unpublish: the sequence number is only taken when something actually goes offline.
  const seq = resolved.some((target) => target.live) ? await step.seq.next() : null;
  for (const { item, locale, live } of resolved) {
    if (live && seq !== null) {
      await unpublishLocale(write, entryId, locale, seq);
      await writeEntryEvent(write.trx, write.siteId, write.model, 'entry.unpublished', entryId, {
        locale,
        snapshot: seq,
      });
    }
    results.push({
      ref: item.ref,
      entryId,
      locale,
      action: 'unpublish',
      snapshot: live ? seq : null,
      revisionId: null,
    });
  }
  return results;
};

const processEntry = async (
  context: ContentServiceContext,
  trx: Transaction<DB>,
  resolved: ResolvedModel,
  entry: { id: string; items: PublicationItem[]; seq: SeqAllocator },
  via: string,
) => {
  const { id: entryId, items, seq } = entry;
  const { model, policy } = resolved;
  const write: WriteContext = { trx, siteId: context.site.id, model, actor: context.actor, now: new Date() };
  const firstRef = items[0]?.ref ?? entryId;
  try {
    assertEntryVisible(
      policy,
      context.actor,
      await entriesRepository.lockLive(entryId, model.definition.id, context.site.id, trx),
      entryId,
    );
  } catch (error) {
    throw new PublicationItemError(firstRef, error);
  }
  const heads = await entryHeadsRepository.lockForEntry(entryId, trx);
  const step = { write, items, heads, seq };
  const results = [
    ...(await publishEntryItems(context, step, entryId)),
    ...(await unpublishEntryItems(context, step, entryId)),
  ];
  await syncEntryUniqueValues(write, entryId);
  await touchEntry(write, entryId);
  for (const action of ['publish', 'unpublish'] as const) {
    const done = results.filter((result) => result.action === action);
    if (done.length > 0) {
      await auditEntry(trx, context, model, `content.${action}`, entryId, {
        locales: done.map((result) => result.locale),
        snapshot: done.find((result) => result.snapshot !== null)?.snapshot ?? null,
        revisions: done.flatMap((result) => (result.revisionId ? [result.revisionId] : [])),
        via,
      });
    }
  }
  return results;
};

/**
 * The batch inside the caller's transaction (a change set ships it right after its schema activation, with
 * the proposed schema as `context.snapshot`). Applies the write policy to every model, locks entries in ID
 * order and publishes everything with the one number from `seq`.
 */
export const runPublicationBatchInTransaction = async (
  context: ContentServiceContext,
  trx: Transaction<DB>,
  items: readonly PublicationItem[],
  via: string,
  seq: SeqAllocator,
): Promise<PublicationResult[]> => {
  const models = await resolveModels(context, items);
  await guardModelVersions(
    trx,
    [...models.values()].map((resolved) => resolved.model),
  );
  await lockItemLocales(trx, items, models);
  const byEntry = new Map<string, PublicationItem[]>();
  for (const item of items) {
    byEntry.set(item.entryId, [...(byEntry.get(item.entryId) ?? []), item]);
  }
  const results: PublicationResult[] = [];
  for (const entryId of [...byEntry.keys()].sort()) {
    const entryItems = byEntry.get(entryId) ?? [];
    const resolved = models.get(entryItems[0]?.modelId ?? '') as ResolvedModel;
    results.push(
      ...(await processEntry(context, trx, resolved, { id: entryId, items: entryItems, seq }, via)),
    );
  }
  return results;
};

/**
 * Runs the batch in its own transaction. Throws `PublicationItemError` naming the item that stopped it
 * (nothing committed), or another error for problems not tied to one item (schema changed meanwhile,
 * database failure).
 */
export const runPublicationBatch = async <T>(
  context: ContentServiceContext,
  items: readonly PublicationItem[],
  via: string,
  meta: SnapshotMeta,
  hooks: BatchHooks<T> = {},
): Promise<{ results: PublicationResult[]; extra: T | undefined }> =>
  context.db.transaction().execute(async (trx) => {
    await hooks.before?.(trx);
    const seq = createSeqAllocator(trx, context.site.id, meta);
    const results = await runPublicationBatchInTransaction(context, trx, items, via, seq);
    const extra = await hooks.after?.(trx, results);
    return { results, extra };
  });
