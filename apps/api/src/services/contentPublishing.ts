import { entryLocaleNotFound, publishingDisabled } from '../content/errors.js';
import type { ContentHooks } from '../content/hooks.js';
import { writeLocaleFor } from '../content/locales.js';
import type { ContentModel } from '../content/model.js';
import { buildValidator } from '../content/validator/index.js';
import { contentInvalid } from '../content/validator/issues.js';
import {
  publishDraft,
  publishRevision,
  syncEntryUniqueValues,
  touchEntry,
  unpublishLocale,
  type WriteContext,
} from '../content/write/heads.js';
import { assertTargets } from '../content/write/references.js';
import { runEntryWrite } from '../content/write/transaction.js';
import type { ContentData } from '../db/contentData.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { HeadRecord } from '../repositories/entryHeads.js';
import { createSeqAllocator, type SeqAllocator } from '../repositories/publications.js';
import { actorColumns } from '../schema/planner/actor.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import {
  assertEntryVisible,
  auditEntry,
  modelWithPolicy,
  writeEntryEvent,
  type ContentServiceContext,
} from './contentAccess.js';
import { viewAfterWrite, type AdminEntryView } from './contentReads.js';

/**
 * Publishing (ADR 0004: strictly per locale). Publishing a locale validates its draft against the current
 * schema, points the published head at an immutable revision, records the publication sequence for
 * `?snapshot=`, and writes the outbox event, all in one transaction (brief §7).
 */
export type PublishTransaction = {
  write: WriteContext;
  snapshot: SchemaSnapshot;
  hooks: ContentHooks;
  /** The transaction's one publication sequence number (shared by a whole batch). */
  seq: SeqAllocator;
};

export type PublishedLocale = { locale: string; revisionId: string; snapshot: number };

/** Publishes the given locales of a locked entry. One publication sequence number covers them all. */
export const publishLocalesInTransaction = async (
  tx: PublishTransaction,
  entryId: string,
  locales: readonly string[],
  heads: readonly HeadRecord[],
): Promise<PublishedLocale[]> => {
  const { write, snapshot, hooks } = tx;
  const { model, trx, actor } = write;
  const validator = buildValidator(snapshot, model);
  const drafts = heads.filter((head) => head.state === 'draft');
  const results: PublishedLocale[] = [];
  for (const locale of locales) {
    const draft = drafts.find((head) => head.locale === locale);
    if (!draft) {
      throw entryLocaleNotFound(
        entryId,
        locale,
        drafts.map((head) => head.locale),
      );
    }
    const outcome = validator.validate(draft.data);
    if (outcome.issues.length > 0) {
      throw contentInvalid(
        outcome.issues.map((issue) => ({ ...issue, message: `${issue.message} (${locale})` })),
      );
    }
    await assertTargets(trx, outcome);
    const published = heads.find((head) => head.state === 'published' && head.locale === locale);
    const context = {
      trx,
      model,
      entryId,
      locale,
      data: outcome.data,
      ...(published ? { before: published.data } : {}),
      actor,
    };
    await hooks.run('beforePublish', context);
    const seq = await tx.seq.next();
    const revisionId = await publishDraft(write, { draft: { ...draft, data: outcome.data }, published, seq });
    await hooks.run('afterPublish', context);
    await writeEntryEvent(trx, model, 'entry.published', entryId, { locale, revisionId, snapshot: seq });
    results.push({ locale, revisionId, snapshot: seq });
  }
  return results;
};

/**
 * Publishes an earlier revision of one locale (restore to a snapshot): validated against the current schema
 * like a draft, then published as a new `restore` revision. The draft head is left as it is.
 */
export const publishRevisionInTransaction = async (
  tx: PublishTransaction,
  entryId: string,
  locale: string,
  source: { id: string; data: ContentData },
  heads: readonly HeadRecord[],
): Promise<PublishedLocale> => {
  const { write, snapshot, hooks } = tx;
  const { model, trx, actor } = write;
  const outcome = buildValidator(snapshot, model).validate(source.data);
  if (outcome.issues.length > 0) {
    throw contentInvalid(
      outcome.issues.map((issue) => ({ ...issue, message: `${issue.message} (${locale})` })),
    );
  }
  await assertTargets(trx, outcome);
  const published = heads.find((head) => head.state === 'published' && head.locale === locale);
  const context = {
    trx,
    model,
    entryId,
    locale,
    data: outcome.data,
    ...(published ? { before: published.data } : {}),
    actor,
  };
  await hooks.run('beforePublish', context);
  const seq = await tx.seq.next();
  const revisionId = await publishRevision(write, {
    entryId,
    locale,
    sourceRevisionId: source.id,
    data: outcome.data,
    published,
    seq,
  });
  await hooks.run('afterPublish', context);
  await writeEntryEvent(trx, model, 'entry.published', entryId, { locale, revisionId, snapshot: seq });
  return { locale, revisionId, snapshot: seq };
};

/** The locales a publish request acts on: the requested ones (or the default), or the only one. */
export const targetLocales = (
  context: ContentServiceContext,
  model: ContentModel,
  requested: readonly string[] | undefined,
  heads: readonly HeadRecord[],
) => {
  if (!model.definition.localized) {
    // A non-localized entry has exactly one locale's heads.
    return [...new Set(heads.filter((head) => head.state === 'draft').map((head) => head.locale))];
  }
  return [
    ...new Set(
      (requested?.length ? requested : [undefined]).map((locale) =>
        writeLocaleFor(context.snapshot, model.definition, locale),
      ),
    ),
  ];
};

type LocalesInput = { locales?: string[] };

const changePublication = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: LocalesInput,
  operation: 'publish' | 'unpublish',
): Promise<AdminEntryView> => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'publish');
  if (!model.definition.draftAndPublish) {
    throw publishingDisabled(modelKey);
  }
  const lockedLocales = model.definition.localized ? targetLocales(context, model, input.locales, []) : [];
  await runEntryWrite(context.db, model, lockedLocales, async (trx) => {
    const write: WriteContext = { trx, model, actor: context.actor, now: new Date() };
    assertEntryVisible(
      policy,
      context.actor,
      await entriesRepository.lockLive(id, model.definition.id, trx),
      id,
    );
    const heads = await entryHeadsRepository.lockForEntry(id, trx);
    const locales = targetLocales(context, model, input.locales, heads);
    let metadata: Record<string, unknown>;
    const seqs = createSeqAllocator(trx, { source: operation, actor: actorColumns(context.actor) });
    if (operation === 'publish') {
      const published = await publishLocalesInTransaction(
        { write, snapshot: context.snapshot, hooks: context.hooks, seq: seqs },
        id,
        locales,
        heads,
      );
      metadata = {
        locales,
        snapshot: published[0]?.snapshot ?? null,
        revisions: published.map((item) => item.revisionId),
      };
    } else {
      const live = locales.filter((locale) =>
        heads.some((head) => head.state === 'published' && head.locale === locale),
      );
      const seq = live.length > 0 ? await seqs.next() : null;
      for (const locale of live) {
        await unpublishLocale(write, id, locale, seq as number);
        await writeEntryEvent(trx, model, 'entry.unpublished', id, { locale, snapshot: seq });
      }
      metadata = { locales: live, snapshot: seq };
    }
    await syncEntryUniqueValues(write, id);
    await touchEntry(write, id);
    await auditEntry(trx, context, model, `content.${operation}`, id, metadata);
  });
  return viewAfterWrite(context, model, policy, id, input.locales?.[0]);
};

/** Publishes one or more locales of an entry ("publish the other outdated locales too" is one call). */
export const publishEntry = (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: LocalesInput,
) => changePublication(context, modelKey, id, input, 'publish');

export const unpublishEntry = (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: LocalesInput,
) => changePublication(context, modelKey, id, input, 'unpublish');
